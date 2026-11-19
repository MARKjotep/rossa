import { SecurityHead } from "./headr.security";

/** * Layer 2: Traffic (Extends SecurityHead)
 */
export class Traffic extends SecurityHead {
  // --- TRAFFIC & PERFORMANCE ---

  cors(origin: string = "*"): this {
    this._add("Access-Control-Allow-Origin", origin);
    this._add(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    this._add("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return this;
  }

  cache(seconds: number = 3600): this {
    return this._add("Cache-Control", `public, max-age=${seconds}`);
  }

  noCache(): this {
    return this._add("Cache-Control", "no-store, no-cache, must-revalidate");
  }

  etag(val: string): this {
    return this._add("ETag", `"${val}"`);
  }

  /** * Set custom timing metrics for browser dev tools.
   */
  serverTiming(name: string, durMs: number, desc: string = ""): this {
    return this._add("Server-Timing", `${name};dur=${durMs};desc="${desc}"`);
  }

  // --- RATE LIMITING (Standard Drafts) ---

  /** Sets standard rate limit headers */
  rateLimit(limit: number, remaining: number, resetSeconds: number): this {
    this._add("X-RateLimit-Limit", limit.toString());
    this._add("X-RateLimit-Remaining", remaining.toString());
    return this._add("X-RateLimit-Reset", resetSeconds.toString());
  }

  /** Sets the Retry-After header (useful for 429 or 503) */
  retryAfter(seconds: number | string): this {
    return this._add("Retry-After", seconds.toString());
  }

  /**
   * Sets the date/time after which the response is considered stale.
   */
  expires(date: Date): this {
    return this._add("Expires", date.toUTCString());
  }

  /**
   * Indicates the date and time at which the resource was last modified.
   */
  lastModified(date: Date): this {
    return this._add("Last-Modified", date.toUTCString());
  }
}
