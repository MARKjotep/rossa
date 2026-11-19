import { ServerSide } from "./server-side";
import { SidGenerator } from "./sid-generator";

export interface AuthConfig {
  COOKIE_NAME?: string;
  COOKIE_LIFETIME?: number; // Days
  COOKIE_DOMAIN?: string | undefined;
  COOKIE_PATH?: string;
  COOKIE_HTTPONLY?: boolean;
  COOKIE_SECURE?: boolean;
  COOKIE_SAMESITE?: "Strict" | "Lax" | "None";
  MAX_COOKIE_SIZE?: number;
  SESSION_LIFETIME?: number;
}

type newSession = {
  sid?: string | undefined;
  readonly?: boolean | undefined;
  isFound?: boolean;
};

export abstract class SessionAuthInterface extends SidGenerator {
  public config: Required<AuthConfig>;
  constructor(config: AuthConfig, salt?: string) {
    super(salt ?? "salty");
    config.COOKIE_NAME = config.COOKIE_NAME ?? "session";

    const {
      COOKIE_NAME = "session",
      COOKIE_LIFETIME = 31,
      COOKIE_DOMAIN = undefined,
      COOKIE_PATH = "/",
      COOKIE_HTTPONLY = true,
      COOKIE_SECURE = true,
      COOKIE_SAMESITE = "Lax",
      MAX_COOKIE_SIZE = 4093,
      SESSION_LIFETIME = 31,
    } = config;

    this.config = {
      COOKIE_NAME,
      COOKIE_LIFETIME,
      COOKIE_DOMAIN,
      COOKIE_PATH,
      COOKIE_HTTPONLY,
      COOKIE_SECURE,
      COOKIE_SAMESITE,
      MAX_COOKIE_SIZE,
      SESSION_LIFETIME,
    };
  }

  // Hook for any async DB setup required by child classes
  public async init(): Promise<void> {}

  /**
   * Verifies the cryptographic signature and opens the session.
   */
  public async openSession(
    sid?: string,
    readonly: boolean = false,
  ): Promise<ServerSide> {
    // If the SID exists and passes signature validation, fetch it from DB!
    if (sid && this.signer.unsign(sid)) {
      return await this.fetchSession(sid, readonly);
    }
    // Signature failed or no SID provided. Issue a brand new session.
    return this.new({});
  }

  /** To be implemented by child class: Retrieve from DB */
  public async fetchSession(sid: string, readonly?: boolean) {
    try {
      const row = await this.fetchData(sid);

      if (row) {
        const initialData = row.data ?? {};
        if (this.isNotExpired(new Date(row.expiration))) {
          return new ServerSide(sid, initialData, readonly, false, true)
            .session;
        }
        return this.new({ sid, isFound: true, readonly });
      }
    } catch (error) {
      console.error(`[AuthEngine] Failed to parse session ${sid}:`, error);
    }

    return this.new({ sid, readonly });
  }

  public abstract fetchData(
    sid: string,
    readonly?: boolean,
  ): Promise<any | undefined>;

  /** To be implemented by child class: Save to DB */
  public abstract saveSession(
    session: ServerSide,
    headers: Headers,
  ): Promise<void>;

  /** To be implemented by child class: Save to DB */
  public abstract deleteSession(
    session: ServerSide,
    headers: Headers,
  ): Promise<void>;

  /*
  -------------------------
  sid?: string | undefined, isFound: boolean = false
  -------------------------
  */
  /** Instantiates a fresh, writable session */

  public new({
    sid,
    isFound = false,
    readonly = false,
  }: newSession): ServerSide {
    return new ServerSide(sid ?? this.generate(), {}, readonly, true, isFound)
      .session;
  }

  /** Instantiates a read-only session */
  public get readonly(): ServerSide {
    return new ServerSide(this.generate(), {}, true).session;
  }

  /**
   * Calculates the exact Date object when this session expires.
   */
  public get getSessionExpirationDate(): Date {
    const now = new Date();
    const lifetimeDays = this.config.SESSION_LIFETIME;
    now.setDate(now.getDate() + lifetimeDays);
    return now;
  }

  public get getCookieExpirationDate(): Date {
    const now = new Date();
    const lifetimeDays = this.config.COOKIE_LIFETIME;
    now.setDate(now.getDate() + lifetimeDays);
    return now;
  }

  /**
   * Verifies if the session is still active and has not expired.
   * @returns true if valid, false if expired.
   */
  isNotExpired(_date: Date): boolean {
    const expireTime = _date.getTime();
    const currentTime = Date.now();

    // If expiration time is in the future, it's NOT expired
    return expireTime > currentTime;
  }

  /**
   * Builds the raw standard HTTP Set-Cookie string.
   */
  public buildCookieString(
    session: ServerSide,
    expirationOverride?: Date | number,
    sameSiteOverride?: AuthConfig["COOKIE_SAMESITE"],
  ): string {
    const parts = [`${this.config.COOKIE_NAME}=${session.sid}`];

    // Path
    parts.push(`Path=${this.config.COOKIE_PATH}`);

    // Domain (The New Addition!)
    if (this.config.COOKIE_DOMAIN) {
      parts.push(`Domain=${this.config.COOKIE_DOMAIN}`);
    }

    // Expiration or Max-Age
    if (typeof expirationOverride === "number") {
      parts.push(`Max-Age=${expirationOverride}`);
    } else {
      const expiryDate = expirationOverride || this.getCookieExpirationDate;
      parts.push(`Expires=${expiryDate.toUTCString()}`);
    }

    // Security Flags
    if (this.config.COOKIE_HTTPONLY) parts.push("HttpOnly");
    if (this.config.COOKIE_SECURE) parts.push("Secure");

    // SameSite Policy
    const sameSite = sameSiteOverride || this.config.COOKIE_SAMESITE;
    if (sameSite) parts.push(`SameSite=${sameSite}`);

    // if (Object.keys(session._cookie).length > 0) {
    //   for (const [key, value] of Object.entries(session._cookie)) {
    //     parts.push(value === true ? key : `${key}=${value}`);
    //   }
    // }

    const finalCookieString = parts.join("; ");

    // ==========================================
    // THE SAFEGUARD CHECK
    // ==========================================
    // We measure the byte length (not just string length) because non-ASCII characters take more space
    const byteLength = Buffer.byteLength(finalCookieString, "utf8");
    const maxSize = this.config.MAX_COOKIE_SIZE;

    if (byteLength > maxSize) {
      throw new Error(
        `[Framework Guard] Cookie exceeds maximum allowed size! ` +
          `Size: ${byteLength} bytes. Max allowed: ${maxSize} bytes. ` +
          `The browser will reject this cookie.`,
      );
    }

    return finalCookieString;
  }

  public setCookie(session: ServerSide, headers: Headers) {
    const cookieString = this.buildCookieString(session);
    headers.append("Set-Cookie", cookieString);
  }
  public removeCookie(session: ServerSide, headers: Headers) {
    const cookieString = this.buildCookieString(session, 0);
    headers.append("Set-Cookie", cookieString);
  }

  /**
   * Extracts the Cookie directly from the Web API Request instance.
   */
  public async loadHeader(
    req: Request,
    readonly: boolean = false,
  ): Promise<[string | undefined, ServerSide]> {
    const cookieHeader = req.headers.get("cookie");

    if (cookieHeader) {
      // Blazing fast regex targeting exactly our cookie name
      const match = cookieHeader.match(
        new RegExp(`(^| )${this.config.COOKIE_NAME}=([^;]+)`),
      );

      if (match) {
        const sid = match[2];

        return [sid, await this.openSession(sid, readonly)];
      }
    }

    // No cookie header found, generate a new session
    return [undefined, this.new({ readonly })];
  }
}
