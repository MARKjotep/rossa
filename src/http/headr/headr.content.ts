import { AuthHead } from "./headr.auth";

type CommonMimeType =
  // Text
  | "text/plain"
  | "text/html"
  | "text/css"
  | "text/javascript"
  | "application/json"
  | "application/xml"

  // Forms & API
  | "application/x-www-form-urlencoded"
  | "multipart/form-data"

  // Audio/Video (Streaming/Common)
  | "audio/mpeg"
  | "video/mp4"

  // Fallback hack to allow any custom string *and* keep autocomplete
  | (string & {});

/** * Layer 3: Auth (Extends AuthHead)
 */
export class Contents extends AuthHead {
  /**
   * Bulk setter for content headers.
   * Accepts an object where keys match semantic method names.
   */
  content(options: {
    length?: number;
    type?: CommonMimeType;
    encoding?: "gzip" | "deflate" | "br" | "identity" | "zstd";
    disposition?: { type: "inline" | "attachment"; filename?: string };
    language?: string;
    range?: string;
    location?: string;
    md5?: string;
  }): this {
    if (options.length !== undefined) this.contentLength(options.length);
    if (options.type) this.contentType(options.type);
    if (options.encoding) this.contentEncoding(options.encoding);
    if (options.language) this.language(options.language);
    if (options.range) this.contentRange(options.range);
    if (options.location) this.contentLocation(options.location);
    if (options.md5) this.contentMD5(options.md5);
    if (options.disposition) {
      this.disposition(options.disposition.type, options.disposition.filename);
    }
    return this;
  }

  /** The size of the response body in bytes */
  contentLength(bytes: number): this {
    return this._add("Content-Length", bytes.toString());
  }

  /** The MD5 hash of the body to verify data integrity */
  contentMD5(hash: string): this {
    return this._add("Content-MD5", hash);
  }

  /** content type */
  contentType(mime: CommonMimeType): this {
    return this._add("Content-Type", mime);
  }

  /** * Defines the compression algorithm used.
   * Common: 'gzip', 'deflate', 'br' (Brotli)
   */
  contentEncoding(
    encoding: "gzip" | "deflate" | "br" | "identity" | "zstd",
  ): this {
    return this._add("Content-Encoding", encoding);
  }

  /** * Where the content actually lives if this is a partial view
   * or a reference to another location.
   */
  contentLocation(url: string): this {
    return this._add("Content-Location", url);
  }

  /** Used to indicate the range of bytes in a partial response (Status 206) */
  contentRange(range: string): this {
    return this._add("Content-Range", range);
  }

  /** Specifies the security level or sensitivity of the content */
  contentSecurity(value: string): this {
    return this._add("Content-Security", value);
  }

  // ---  ---------------------------------------------------------------

  /** * Controls if content is displayed inline or as an attachment (download).
   * @param type 'inline' or 'attachment'
   * @param filename Optional name for the downloaded file
   */
  disposition(
    type: "inline" | "attachment" = "attachment",
    filename?: string,
  ): this {
    const value = filename ? `${type}; filename="${filename}"` : type;
    return this._add("Content-Disposition", value);
  }

  // --- CONTENT NEGOTIATION ---

  /** Tells the client which request headers were used to decide the response */
  vary(...headers: string[]): this {
    return this._add("Vary", headers.join(", "));
  }

  /** Suggests a language for the content */
  language(lang: string): this {
    return this._add("Content-Language", lang);
  }
}
