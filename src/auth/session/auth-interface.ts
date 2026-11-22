import { ServerSide, type SessionInstance } from "./server-side";
import { SidGenerator } from "./sid-generator";

export interface AuthConfig {
  COOKIE_NAME?: string;
  COOKIE_LIFETIME?: number; // Days (fractional values are honoured to the millisecond)
  COOKIE_DOMAIN?: string | undefined;
  COOKIE_PATH?: string;
  COOKIE_HTTPONLY?: boolean;
  COOKIE_SECURE?: boolean;
  COOKIE_SAMESITE?: "Strict" | "Lax" | "None";
  MAX_COOKIE_SIZE?: number;
  SESSION_LIFETIME?: number; // Days (fractional values are honoured to the millisecond)
}

type newSession = {
  sid?: string | undefined;
  readonly?: boolean | undefined;
  isFound?: boolean;
};

const DAY_IN_MILLISECONDS = 86_400_000;

/**
 * Abstract session service: signing, cookie serialization, expiration, and
 * identifier rotation. Subclasses implement the storage hooks.
 *
 * @typeParam TData - Shape of the data stored on the session. It types the
 * resolved session (see {@link SessionInstance}) without casts.
 */
export abstract class SessionAuthInterface<
  TData extends Record<string, any> = Record<string, any>,
> extends SidGenerator {
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
  ): Promise<SessionInstance<TData>> {
    // If the SID exists and passes signature validation, fetch it from DB!
    if (sid && this.signer.unsign(sid)) {
      return await this.fetchSession(sid, readonly);
    }
    // Signature failed or no SID provided. Issue a brand new session.
    return this.new({});
  }

  /** To be implemented by child class: Retrieve from DB */
  public async fetchSession(
    sid: string,
    readonly?: boolean,
  ): Promise<SessionInstance<TData>> {
    try {
      const row = await this.fetchData(sid);

      if (row) {
        const initialData = (row.data ?? {}) as Partial<TData>;
        if (this.isNotExpired(new Date(row.expiration))) {
          return this.materialize(
            new ServerSide<TData>(sid, initialData, readonly, false, true),
          );
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
  }: newSession): SessionInstance<TData> {
    return this.materialize(
      new ServerSide<TData>(sid ?? this.generate(), {}, readonly, true, isFound),
    );
  }

  /** Instantiates a read-only session */
  public get readonly(): SessionInstance<TData> {
    return this.materialize(new ServerSide<TData>(this.generate(), {}, true));
  }

  /**
   * Attaches the rotation hook and exposes the proxy that merges the
   * framework API with the session data.
   */
  protected materialize(session: ServerSide<TData>): SessionInstance<TData> {
    session.setRotator(() => this.rotateSession(session));
    return session.session;
  }

  /**
   * Mints a new signed `sid` for the session and deletes the previous row.
   *
   * The guard persists the new row (and sends its cookie) after the handler
   * returns because the session is marked modified. Used by
   * {@link ServerSide.rotate}; call that instead of this method directly.
   *
   * @param session - Session to re-key. Must not be readonly.
   */
  public async rotateSession(session: ServerSide<TData>): Promise<void> {
    if (session.isReadOnly) {
      console.warn("session: readonly");
      return;
    }

    const previousSid = session.sid;

    if (previousSid && session.isFound) {
      await this.removeStoredSession(previousSid);
    }

    session.renewSid(this.generate());
    session.isNew = false;
    session.isFound = true;
    session.isModified = true;
  }

  /**
   * Deletes a stored row without emitting a cookie for the new session.
   * A store that fails after deleting the row (for example while serializing
   * the removal cookie) is still treated as successful.
   */
  private async removeStoredSession(sid: string): Promise<void> {
    const stale = new ServerSide<TData>(sid, {}, false, false, true);

    try {
      await this.deleteSession(stale, new Headers());
    } catch (error) {
      let stillStored = true;

      try {
        stillStored = Boolean(await this.fetchData(sid));
      } catch {
        stillStored = true;
      }

      if (stillStored) throw error;
    }
  }

  /**
   * Calculates the exact Date object when this session expires.
   *
   * Fractional-day lifetimes are preserved: computation is performed in
   * milliseconds instead of truncating through `Date#setDate`.
   */
  public get getSessionExpirationDate(): Date {
    return new Date(
      Date.now() + this.config.SESSION_LIFETIME * DAY_IN_MILLISECONDS,
    );
  }

  /**
   * Calculates the exact Date object when the session cookie expires.
   *
   * Fractional-day lifetimes are preserved to the millisecond.
   */
  public get getCookieExpirationDate(): Date {
    return new Date(
      Date.now() + this.config.COOKIE_LIFETIME * DAY_IN_MILLISECONDS,
    );
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
  ): Promise<[string | undefined, SessionInstance<TData>]> {
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
