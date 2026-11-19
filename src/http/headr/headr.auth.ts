import { Traffic } from "./headr.traffic";

/** * Layer 3: Auth (Extends Traffic)
 */
export class AuthHead extends Traffic {
  // --- AUTHENTICATION & IDENTITY ---

  /** * Sets the WWW-Authenticate header for 401 responses.
   * e.g., head.authenticate("Bearer", "realm=\"access\"")
   */
  authenticate(scheme: "Bearer" | "Basic" | "Digest", details?: string): this {
    const value = details ? `${scheme} ${details}` : scheme;
    return this._add("WWW-Authenticate", value);
  }

  /** * Sets the Proxy-Authenticate header.
   */
  proxyAuthenticate(value: string): this {
    return this._add("Proxy-Authenticate", value);
  }
}
