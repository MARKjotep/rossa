import { createHmac, randomUUID, timingSafeEqual } from "crypto";

// Export the singleton for your app
// export const jwtEngine = new JwtEngine(
//   process.env.JWT_SECRET || "super_secret_jwt_key",
// );

export type JwtPayload<T> = T & {
  iat: number;
  exp: number;
  /**
   * Unique token identifier assigned on every signature.
   *
   * Optional only so tokens issued before this claim existed remain readable.
   */
  jti?: string;
};

export class JwtEngine<T extends Record<string, any> = Record<string, any>> {
  private readonly secretKey: Buffer;

  constructor(secret: string) {
    if (!secret) {
      throw new Error("JWT secret key must be provided.");
    }
    this.secretKey = Buffer.from(secret, "utf8");
  }

  /**
   * Generates a signed JWT Access Token.
   *
   * A fresh `jti` is always assigned, so signing the same claims twice within
   * the same clock second still produces two distinct tokens. Any caller
   * supplied `jti`, `iat`, or `exp` is replaced rather than reused.
   */
  public sign(payload: T, expiresInMinutes: number = 15): string {
    if (!Number.isFinite(expiresInMinutes) || expiresInMinutes <= 0) {
      throw new RangeError(
        "Token validity must be a positive number of minutes.",
      );
    }

    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);

    const fullPayload: JwtPayload<T> = {
      ...payload,
      iat: now,
      exp: now + expiresInMinutes * 60,
      // Assigned after the spread: when rotation re-issues consumed refresh
      // claims, the previous `jti` must never carry over.
      jti: randomUUID(),
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
      "base64url",
    );
    const encodedPayload = Buffer.from(JSON.stringify(fullPayload)).toString(
      "base64url",
    );
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;

    const signature = createHmac("sha256", this.secretKey)
      .update(unsignedToken)
      .digest("base64url");

    return `${unsignedToken}.${signature}`;
  }

  /**
   * Verifies the JWT mathematically. Returns payload if valid, or null if expired/tampered.
   */
  public verify(token: string): JwtPayload<T> | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;

      const [encodedHeader, encodedPayload, providedSignature] = parts;
      const unsignedToken = `${encodedHeader}.${encodedPayload}`;

      // 1. Verify Header algorithm
      const header = JSON.parse(
        Buffer.from(encodedHeader || "", "base64url").toString("utf8"),
      );
      if (
        !header ||
        typeof header !== "object" ||
        header.alg !== "HS256" ||
        header.typ !== "JWT"
      )
        return null;

      // 2. Cryptographic Signature Verification (Timing Safe)
      const expectedSignature = createHmac("sha256", this.secretKey)
        .update(unsignedToken)
        .digest("base64url");

      const expectedBuffer = Buffer.from(expectedSignature);
      const providedBuffer = Buffer.from(providedSignature || "");

      if (
        expectedBuffer.length !== providedBuffer.length ||
        !timingSafeEqual(expectedBuffer, providedBuffer)
      ) {
        return null;
      }

      // 3. Expiration Check
      const payload: JwtPayload<T> = JSON.parse(
        Buffer.from(encodedPayload || "", "base64url").toString("utf8"),
      );
      if (
        !payload ||
        typeof payload !== "object" ||
        !Number.isFinite(payload.iat) ||
        !Number.isFinite(payload.exp)
      )
        return null;
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp <= now) {
        return null;
      }

      return payload;
    } catch {
      // Handles invalid base64 or malformed JSON payloads safely
      return null;
    }
  }

  // --- Refresh Token Methods ---

  /**
   * Issues a long-lived refresh token.
   *
   * Each call produces a distinct token because `sign` assigns a fresh `jti`,
   * which is what makes rotation + single-use stores replay-safe.
   */
  public issue(data: T, daysValid: number = 7): string {
    const minutesValid = daysValid * 24 * 60;
    return this.sign(data, minutesValid);
  }
}
