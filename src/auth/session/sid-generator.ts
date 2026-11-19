import { randomBytes } from "crypto";
import { Signator } from "./signator";

// Assuming Signator is defined elsewhere in your project

export class SidGenerator {
  protected signer: Signator;

  constructor(salt: string) {
    this.signer = new Signator(salt);
  }

  /**
   * Generates a URL-safe, cryptographically secure, signed session ID.
   */
  public generate(len: number = 21): string {
    // 'base64url' natively omits trailing '=' and makes it cookie-safe!
    const rawUrlSafeBase64 = randomBytes(len).toString("base64url");
    return this.signer.sign(rawUrlSafeBase64);
  }
}
