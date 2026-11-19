import { HeadBase } from "./headr.base";

/** * Layer 1: Security
 */
export class SecurityHead extends HeadBase {
  /** * Prevents clickjacking by forbidding the page from being framed.
   * Options: 'DENY', 'SAMEORIGIN'
   */
  frameOptions(option: "DENY" | "SAMEORIGIN" = "DENY"): this {
    return this._add("X-Frame-Options", option);
  }

  /** * Forces browser to stick to the declared Content-Type.
   */
  noSniff(): this {
    return this._add("X-Content-Type-Options", "nosniff");
  }

  /** * Forces HTTPS for a set duration (default 1 year).
   */
  hsts(maxAge: number = 31536000): this {
    return this._add(
      "Strict-Transport-Security",
      `max-age=${maxAge}; includeSubDomains; preload`,
    );
  }

  /** * Basic CSP: Only allow scripts/styles from your own origin.
   */
  csp(policy: string = "default-src 'self'"): this {
    return this._add("Content-Security-Policy", policy);
  }

  /** Referrer policy for privacy */
  referrer(
    policy:
      | "no-referrer"
      | "origin"
      | "strict-origin-when-cross-origin" = "strict-origin-when-cross-origin",
  ): this {
    return this._add("Referrer-Policy", policy);
  }

  /** * NEW: Cross-Origin Opener Policy (Isolates your tab from others)
   */
  coop(
    policy:
      | "same-origin"
      | "same-origin-allow-popups"
      | "unsafe-none" = "same-origin",
  ): this {
    return this._add("Cross-Origin-Opener-Policy", policy);
  }

  /** * NEW: Cross-Origin Embedder Policy
   */
  coep(policy: "require-corp" | "unsafe-none" = "require-corp"): this {
    return this._add("Cross-Origin-Embedder-Policy", policy);
  }

  /** * Modern replacement for Feature-Policy.
   * e.g., "camera=(), microphone=()"
   */
  permissions(policy: string): this {
    return this._add("Permissions-Policy", policy);
  }
}
