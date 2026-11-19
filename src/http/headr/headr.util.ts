import { Contents } from "./headr.content";

/** * Layer 5: Auth (Extends Traffic)
 */
export class Utils extends Contents {
  location(url: string): this {
    return this._add("Location", url);
  }

  /**
   * Specifically sets the Access-Control-Allow-Origin header.
   */
  origin(value: string = "*"): this {
    return this._add("Access-Control-Allow-Origin", value);
  }

  /**
   * The date and time at which the message was originated.
   */
  date(date: Date = new Date()): this {
    return this._add("Date", date.toUTCString());
  }

  /**
   * Contains information about the software used by the origin server.
   */
  server(name: string): this {
    return this._add("Server", name);
  }

  /**
   * Controls whether the network connection stays open after the transaction finishes.
   * Common: 'keep-alive', 'close'
   */
  connection(value: "keep-alive" | "close"): this {
    return this._add("Connection", value);
  }

  /**
   * Sets parameters for a persistent connection (timeout and max requests).
   * e.g., head.keepAlive("timeout=5, max=1000")
   */
  keepAlive(value: string | number): this {
    return this._add("Keep-Alive", String(value));
  }

  cookie(
    name: string,
    value: string,
    options: CookieOptions = {
      sameSite: "Strict",
      httpOnly: true,
      path: "/",
    },
  ): this {
    if (!options.expires) {
      const d = new Date();
      d.setDate(d.getDate() + 31);
      options.expires = d;
    }

    return this._add("Set-Cookie", setCookie(name, value, options));
  }
}

export interface CookieOptions {
  /**
   * Max-Age in seconds, or a Date from which seconds will be derived.
   */
  maxAge?: number | Date;

  /**
   * Expires as Date, timestamp, or preformatted date string.
   */
  expires?: Date | number | string;

  path?: string | null;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None" | null;
  /**
   * Internal only – not serialized; used if you actually measure size.
   */
  maxSize?: number;
  syncExpires?: boolean;
}

export const setCookie = (
  key: string,
  value = "",
  options: CookieOptions = {},
): string => {
  const { maxAge, expires, path, domain, secure, httpOnly, sameSite } = options;

  const normalizedMaxAge =
    maxAge instanceof Date
      ? Math.floor(maxAge.getTime() / 1000)
      : typeof maxAge === "number"
        ? maxAge
        : undefined;

  let normalizedExpires: string | undefined;
  if (expires instanceof Date) {
    normalizedExpires = expires.toUTCString();
  } else if (typeof expires === "number") {
    normalizedExpires = new Date(expires).toUTCString();
  } else if (typeof expires === "string") {
    normalizedExpires = expires;
  } else if (expires === 0) {
    normalizedExpires = new Date().toUTCString();
  }
  const directives: string[] = [];

  if (domain) directives.push(`Domain=${domain}`);
  if (normalizedExpires) directives.push(`Expires=${normalizedExpires}`);
  if (normalizedMaxAge !== undefined)
    directives.push(`Max-Age=${normalizedMaxAge}`);
  if (secure) directives.push("Secure");
  if (httpOnly) directives.push("HttpOnly");
  if (path != null) directives.push(`Path=${path}`);
  if (sameSite != null) directives.push(`SameSite=${sameSite}`);

  return [`${key}=${value}`, ...directives].join("; ");
};
