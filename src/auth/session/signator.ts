// src/blueprints/auth/Signator.ts
import { createHmac, createHash, timingSafeEqual } from "crypto";

export class Signator {
  private readonly key: Buffer;

  constructor(public salt: string) {
    // Derive a consistent, secure 32-byte key from your salt string
    this.key = createHash("sha256").update(salt).digest();
  }

  /**
   * Generates an HMAC SHA-256 signature, encoded cleanly for URLs.
   */
  public getSignature(val: string): string {
    return createHmac("sha256", this.key).update(val).digest("base64url");
  }

  /**
   * Attaches the signature to the value using the standard "." separator.
   * Format: payload.signature
   */
  public sign(val: string): string {
    const sig = this.getSignature(val);
    return `${val}.${sig}`;
  }

  /**
   * Verifies a signed string.
   * Returns the original value if valid, or null if tampered/invalid.
   */
  public unsign(signedVal: string): string | null {
    const separatorIndex = signedVal.indexOf(".");

    // Graceful failure: If there is no separator, it's a forged/broken cookie
    if (separatorIndex === -1) {
      return null;
    }

    const val = signedVal.slice(0, separatorIndex);
    const sig = signedVal.slice(separatorIndex + 1);

    if (this.verifySignature(val, sig)) {
      return val;
    }

    return null;
  }

  /**
   * Cryptographically secure comparison to prevent Timing Attacks.
   */
  private verifySignature(val: string, providedSig: string): boolean {
    const expectedSig = Buffer.from(this.getSignature(val), "utf8");
    const incomingSig = Buffer.from(providedSig, "utf8");

    // To use timingSafeEqual, the buffers MUST be the exact same length.
    // If an attacker sends a signature of the wrong length, fail instantly.
    if (expectedSig.length !== incomingSig.length) {
      return false;
    }

    // Compares bits in constant time, blinding the CPU execution duration
    return timingSafeEqual(expectedSig, incomingSig);
  }
}
