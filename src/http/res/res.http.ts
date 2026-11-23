import { type Server, type BunFile } from "bun";
import { Compressor, type ContentEncodingType } from "./res.compressor";
import { Heder } from "../headr";
import {
  setCookie as serializeCookie,
  type CookieOptions,
} from "../headr/headr.util";
import { eStream, type StreamPushFn } from "./stream.res";
import { isRecord, retry, type StaticOnly } from "@ohmyqt/u";
import type { StaticFileServer } from "@/core/static-server";
import type { Req } from "../req";

// Assuming these are your external dependencies

export type HeaderObject = Record<string, string>;

/** RFC 9110 `token` characters accepted as a header field name. */
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Characters Bun's `Headers` rejects in a field value: control characters
 * (including CR/LF/NUL) and code points above Latin-1.
 */
const INVALID_HEADER_VALUE = /[^\t\x20-\x7e\x80-\xff]/g;

const isHeaderName = (name: string): boolean => HEADER_NAME_PATTERN.test(name);

/**
 * Removes characters that would be rejected by `Headers` (or could split a
 * value into additional headers) so a stored header always serializes safely.
 */
const sanitizeHeaderValue = (value: unknown): string =>
  (value === null || value === undefined ? "" : String(value)).replace(
    INVALID_HEADER_VALUE,
    "",
  );

/**
 * Removes every header from `input` whose name or value would make `Headers`
 * throw, returning a fresh object safe to pass to `new Response`.
 */
const safeHeaders = (input: HeaderObject): HeaderObject => {
  const output: HeaderObject = {};
  for (const [name, value] of Object.entries(input)) {
    if (!isHeaderName(name)) continue;
    output[name] = sanitizeHeaderValue(value);
  }
  return output;
};

/**
 * Percent-decodes `value` up to three times so double/triple-encoded
 * authorities such as `/%252f%252fhost` cannot slip past the checks.
 */
const decodeRedirectTarget = (value: string): string => {
  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    if (!decoded.includes("%")) break;
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // A malformed escape cannot resolve to an authority; validate as-is.
      break;
    }
  }
  return decoded;
};

/** Characters that URL parsers/browsers may treat as separators or ignore. */
const UNSAFE_REDIRECT_CHARACTERS = /[\u0000-\u001f\u007f\\]/;

/** Matches a leading `<scheme>:` such as `javascript:` or `data:`. */
const REDIRECT_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Returns the safe, origin-relative form of `url`, or `null` when the target
 * could leave the current origin.
 *
 * Root-relative targets are returned unchanged. Safe bare relatives are
 * normalized to a root-relative path, so `dashboard` becomes `/dashboard` and
 * `?q=1` becomes `/?q=1`; callers can forward them without prefixing first.
 */
const normalizeLocalRedirectTarget = (url: string): string | null => {
  if (typeof url !== "string") return null;
  // Empty and whitespace-only values are not destinations; surrounding
  // whitespace is rejected rather than trimmed so the target is unambiguous.
  if (url.trim() === "" || url !== url.trim()) return null;

  const decoded = decodeRedirectTarget(url);

  // Control characters, NUL, and backslashes can confuse URL parsers/browsers.
  if (UNSAFE_REDIRECT_CHARACTERS.test(decoded)) return null;

  // No scheme (javascript:, data:, http:, …) may survive decoding.
  if (REDIRECT_SCHEME.test(decoded)) return null;

  if (url.startsWith("/")) {
    // Protocol-relative (`//host`) and backslash-authority (`/\host`) forms.
    // A leading slash that only appears after decoding is an encoded-authority
    // form (`%2F%2Fhost`), handled below.
    return decoded.startsWith("//") ? null : url;
  }

  // Encoded-authority form: the leading slash was hidden behind an escape.
  if (decoded.startsWith("/")) return null;

  return `/${url}`;
};

/**
 * Returns `url` when it is an absolute `http:`/`https:` URL, or `null` for
 * protocol-relative, scheme, backslash, relative, or unparsable targets.
 */
const normalizeExternalRedirectTarget = (url: string): string | null => {
  if (typeof url !== "string") return null;
  if (url.trim() === "" || url !== url.trim()) return null;
  if (UNSAFE_REDIRECT_CHARACTERS.test(url)) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Relative and protocol-relative targets have no absolute authority.
    return null;
  }

  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? url
    : null;
};

/**
 * Returns `true` when `url` is a safe origin-relative redirect target.
 *
 * Root-relative targets must not become an absolute, protocol-relative,
 * backslash, or scheme target after percent-decoding (up to three times,
 * covering double/triple-encoded authority tricks). Safe bare relatives
 * (`dashboard`, `?q=1`) are accepted and treated as normalized paths
 * (`/dashboard`, `/?q=1`), matching {@link res.redirect} and
 * {@link res.redirectLocal}. Off-origin destinations belong to
 * {@link res.redirectExternal}.
 *
 * @example
 * ```ts
 * isLocalRedirectTarget("/dashboard");        // true
 * isLocalRedirectTarget("dashboard");         // true (normalizes to /dashboard)
 * isLocalRedirectTarget("https://evil.test"); // false
 * isLocalRedirectTarget("//evil.test");       // false
 * isLocalRedirectTarget("/%2f%2fevil.test");  // false
 * ```
 *
 * @param url - Candidate redirect target.
 * @returns Whether the target stays on the current origin.
 */
export function isLocalRedirectTarget(url: string): boolean {
  return normalizeLocalRedirectTarget(url) !== null;
}

export interface RespoOptions {
  /** Compression encoding to apply to generated response bodies. */
  encoding?: ContentEncodingType;
}

export interface FileMeta {
  /** Byte length of a raw `Uint8Array` file. */
  size: number;
  /** MIME type of a raw `Uint8Array` file. */
  type: string;
}

/** Builds HTTP responses while retaining status, headers, and encoding settings. */
export class res {
  private _code: number = 200;
  private _headers: HeaderObject = {};
  private _cookies: string[] = [];
  private _encoding?: ContentEncodingType;

  /**
   * Creates a response builder for the current request.
   *
   * @param options - Optional response encoding settings.
   * @param req - The request context used by file serving and streaming helpers.
   * @param staticServer - Static file server used by {@link fileServer}.
   * @param server - Optional Bun server. Streaming helpers need it to disable
   * Bun's request timeout for the long-lived connection.
   */
  constructor(
    options: RespoOptions = {},
    public readonly req: Req,
    private readonly staticServer: StaticFileServer,
    private readonly server?: Bun.Server<undefined>,
  ) {
    if (options.encoding) {
      this.encode(
        Compressor.negotiate(
          options.encoding,
          req.headers.get("accept-encoding"),
        ) ?? "none",
      );
    }
  }

  /**
   * Sets the HTTP response status code.
   * * ### 1xx: Informational
   * - **101 (Switching Protocols):** Switching to WebSockets.
   * * ### 2xx: Success
   * - **200 (OK):** Request succeeded.
   * - **201 (Created):** Resource created (e.g., new database record).
   * - **202 (Accepted):** Request accepted but still processing (Async).
   * - **204 (No Content):** Success, but returning no body (e.g., OPTIONS/DELETE).
   * - **206 (Partial Content):** Range request success (Streaming).
   * * ### 3xx: Redirection
   * - **301 (Moved Permanently):** Permanent URL change.
   * - **302 (Found):** Temporary URL change.
   * - **304 (Not Modified):** Use the browser's cached version.
   * - **307/308:** Temporary/Permanent redirect (preserves POST data).
   * * ### 4xx: Client Errors
   * - **400 (Bad Request):** Invalid syntax or malformed data.
   * - **401 (Unauthorized):** Authentication is missing or invalid.
   * - **403 (Forbidden):** Authenticated but lacks permissions.
   * - **404 (Not Found):** Resource doesn't exist.
   * - **405 (Method Not Allowed):** e.g., POSTing to a GET-only route.
   * - **406 (Not Acceptable):** Requested format (Accept header) not supported.
   * - **408 (Request Timeout):** Client took too long to send data.
   * - **409 (Conflict):** State conflict (e.g., duplicate username).
   * - **410 (Gone):** Resource is permanently deleted.
   * - **413 (Payload Too Large):** Request body exceeds limits.
   * - **415 (Unsupported Media Type):** e.g., sending XML when API expects JSON.
   * - **416 (Range Not Satisfiable):** Invalid byte range requested.
   * - **422 (Unprocessable Entity):** Validation error (correct syntax, wrong data).
   * - **429 (Too Many Requests):** Rate limit exceeded.
   * * ### 5xx: Server Errors
   * - **500 (Internal Server Error):** General server crash.
   * - **501 (Not Implemented):** Server doesn't support the requested method.
   * - **502 (Bad Gateway):** Upstream server (proxy) sent an invalid response.
   * - **503 (Service Unavailable):** Server is overloaded or down for maintenance.
   * - **504 (Gateway Timeout):** Upstream server took too long to respond.
   * * @param code - The numeric HTTP status code.
   */
  status(code: number): this {
    this._code = code;
    return this;
  }

  /**
   * Sets the Content-Encoding header and internal state.
   */
  /**
   * Sets or clears the response content encoding.
   *
   * @param type - Encoding to use, or `"none"` to remove the encoding header.
   * @returns This response builder for chaining.
   */
  encode(type: ContentEncodingType): this {
    this._encoding = type;
    if (type && type !== "none") {
      this._headers["Content-Encoding"] = type;
    } else {
      delete this._headers["Content-Encoding"];
    }
    return this;
  }
  // ---  ---------------------------------------------------------------

  /**
   * Consumes the Head builder object.
   */
  /**
   * Adds or replaces response headers. `Vary` values are merged without
   * duplicates so callers can add negotiation dimensions incrementally.
   *
   * Header values are sanitized on write: CR, LF, NUL, other control
   * characters, and code points that `Headers` cannot serialize are removed so
   * a value derived from user input can never inject extra headers or poison
   * the response builder. Invalid header names are ignored.
   *
   * @param input - A header builder or a map of header names to values.
   * @returns This response builder for chaining.
   */
  header(input: Heder | HeaderObject): this {
    const headers = input instanceof Heder ? input.done : input;
    for (const [name, rawValue] of Object.entries(headers)) {
      if (!isHeaderName(name)) continue;
      const value = sanitizeHeaderValue(rawValue);
      if (name.toLowerCase() === "vary" && this._headers.Vary) {
        const existing = this._headers.Vary;
        if (existing.trim() === "*") continue;
        const varyValues = existing.split(",").map((item) => item.trim());
        for (const item of value.split(",").map((entry) => entry.trim())) {
          if (
            !varyValues.some(
              (current) => current.toLowerCase() === item.toLowerCase(),
            )
          ) {
            varyValues.push(item);
          }
        }
        this._headers.Vary = varyValues.join(", ");
      } else {
        this._headers[name] = value;
      }
    }
    return this;
  }

  /**
   * Appends a cookie to the response.
   *
   * Each call adds one independent `Set-Cookie` header, so multiple cookies are
   * preserved and never merged into a single value. Serialization uses the same
   * builder as {@link Heder.cookie} and the resulting value is sanitized like
   * every other header, preventing CR/LF injection.
   *
   * ```ts
   * res.setCookie("csrf_token", token, { path: "/", httpOnly: false, sameSite: "Lax" });
   * ```
   *
   * @param name - Cookie name.
   * @param value - Cookie value; use `clearCookie` to expire one.
   * @param options - Flags and lifetime. `Path` defaults to `/`.
   * @returns This response builder for chaining.
   */
  setCookie(name: string, value: string, options: CookieOptions = {}): this {
    const resolved: CookieOptions = { path: "/", ...options };
    this._cookies.push(
      sanitizeHeaderValue(serializeCookie(name, value, resolved)),
    );
    return this;
  }

  /**
   * Expires a cookie with `Max-Age=0` and an epoch `Expires` date.
   *
   * The `Path` and `Domain` (when supplied) must match the original cookie so
   * the browser removes the same entry.
   *
   * ```ts
   * res.clearCookie("csrf_token", { path: "/" });
   * ```
   *
   * @param name - Cookie name.
   * @param options - Flags matching the original cookie. `Path` defaults to `/`.
   * @returns This response builder for chaining.
   */
  clearCookie(name: string, options: CookieOptions = {}): this {
    return this.setCookie(name, "", {
      ...options,
      maxAge: 0,
      expires: new Date(0),
    });
  }

  /**
   * Builds the response header set, appending every queued `Set-Cookie`
   * separately so multiple cookies survive the trip to `Response#headers`.
   */
  private _buildHeaders(): Headers {
    const headers = new Headers(safeHeaders(this._headers));
    for (const cookie of this._cookies) {
      headers.append("Set-Cookie", cookie);
    }
    return headers;
  }

  private _assemble(body: any, contentType: string): Response {
    const raw = Compressor.toUint8(body);
    const { payload, encoding } = Compressor.handle(raw, this._encoding);

    if (encoding) {
      this._headers["Content-Encoding"] = encoding;
    }

    const needsCharset =
      (contentType.startsWith("text/") || contentType === "application/json") &&
      !contentType.includes("charset=");

    const headers = this._buildHeaders();
    if (!headers.has("Content-Type")) {
      headers.set(
        "Content-Type",
        needsCharset ? `${contentType}; charset=utf-8` : contentType,
      );
    }
    if (!headers.has("Content-Length")) {
      headers.set("Content-Length", payload.length.toString());
    }

    return new Response(payload as BodyInit, {
      status: this._code,
      headers,
    });
  }

  /**
   * Creates a response with no body using the supplied status or current status.
   *
   * @param status - Optional status code for this response.
   */
  null(status: number = this._code): Response {
    return new Response(null, {
      status,
      headers: this._buildHeaders(),
    });
  }

  /** Serializes a value as JSON and returns an `application/json` response. */
  json(data: Record<string, any>): Response {
    return this._assemble(data, "application/json");
  }

  /** Returns an HTML response with a UTF-8 content type. */
  html(body: string): Response {
    return this._assemble(body, "text/html");
  }

  /** Returns a plain text response with a UTF-8 content type. */
  text(body: string = ""): Response {
    return this._assemble(body, "text/plain");
  }
  /**
   * Standardized Error Response.
   * Automatically sets the status code and returns a JSON error structure.
   * * ### Common Error Codes:
   * - **400 (Bad Request):** The server cannot process the request due to client error (e.g., malformed syntax).
   * - **401 (Unauthorized):** Authentication is required and has failed or has not yet been provided.
   * - **403 (Forbidden):** The server understood the request but refuses to authorize it.
   * - **404 (Not Found):** The requested resource could not be found.
   * - **405 (Method Not Allowed):** The request method is known by the server but has been disabled.
   * - **409 (Conflict):** Request conflicts with current state (e.g., duplicate entry).
   * - **413 (Payload Too Large):** The request entity is larger than limits defined by server.
   * - **415 (Unsupported Media Type):** The media format of the requested data is not supported.
   * - **422 (Unprocessable Entity):** Valid syntax but contains semantic errors (e.g., validation failed).
   * - **429 (Too Many Requests):** The user has sent too many requests in a given amount of time.
   * - **500 (Internal Server Error):** A generic error message, given when an unexpected condition was encountered.
   * - **503 (Service Unavailable):** The server is currently unable to handle the request (overloaded or down).
   * @param code - The numeric HTTP error status code.
   * @param message - A human-readable explanation of the error.
   * @param details - Optional object or array containing specific error details (e.g., field-level validation).
   */
  error(code: number, message: string | Record<string, any>): Response {
    this._code = code;

    let _message = "";
    let _type = "text/plain";
    if (isRecord(message)) {
      _message = JSON.stringify(message);
      _type = "application/json";
    } else {
      _message = String(message);
    }

    return this._assemble(_message, _type);
    // return sendError({ code, message, headers: this._headers }, details);
  }

  /**
   * Standardized Success Response.
   * Automatically sets the status code and returns a JSON success structure.
   * * ### Common Success Codes:
   * - **200 (OK):** The request was successful and the payload is returned in the response body.
   * - **201 (Created):** The request succeeded and a new resource was created (e.g., successful insert or register).
   * - **202 (Accepted):** The request was received but has not yet been acted upon (e.g., background job started).
   * - **204 (No Content):** The request succeeded but there is no payload to return (e.g., successful delete).
   * * @param code - The numeric HTTP success status code (defaults to 200).
   * @param data - Optional primary payload or resource data returned to the client.
   * @param message - Optional human-readable confirmation message.
   */
  success(code: number = 200, data?: any, message?: string): Response {
    this._code = code;
    return this.json({
      success: true,
      ...(message && { message }),
      ...(data !== undefined && { data }),
    });
  }

  /**
   * Builds the rejection response for an invalid redirect target: `400` with
   * `{"success":false,"error":"Invalid redirect target"}` and no `Location`.
   */
  private _invalidRedirect(): Response {
    for (const name of Object.keys(this._headers)) {
      if (name.toLowerCase() === "location") delete this._headers[name];
    }
    return this.error(400, {
      success: false,
      error: "Invalid redirect target",
    });
  }

  /** Emits an empty redirect with a sanitized `Location` value. */
  private _redirectTo(target: string, status: number): Response {
    const headers = this._buildHeaders();
    headers.set("Location", sanitizeHeaderValue(target));
    return new Response(null, {
      status,
      headers,
    });
  }

  /**
   * Creates an empty redirect response to a safe origin-relative target.
   *
   * Safe by default: the target is validated with the same rules as
   * {@link isLocalRedirectTarget}. Absolute (`https://evil.test`),
   * protocol-relative (`//evil.test`), backslash, scheme (`javascript:`,
   * `data:`), and encoded-authority (`/%2f%2fevil.test`) targets are rejected
   * with `400` and the JSON body
   * `{"success":false,"error":"Invalid redirect target"}`; no `Location`
   * header is emitted.
   *
   * Plain paths are emitted unchanged (`/account?id=1&tab=prefs`), and safe
   * bare relatives are normalized (`dashboard` → `/dashboard`,
   * `?q=1` → `/?q=1`), so untrusted input cannot redirect off-origin. Use
   * {@link redirectExternal} for a deliberate off-origin hop such as an OAuth
   * authorize URL. CR/LF/NUL and other control characters are removed from the
   * emitted `Location` value so it cannot inject additional headers.
   *
   * @param url - Origin-relative destination, for example `/dashboard`.
   * @param status - Redirect status code; defaults to `302` (also accepts
   * `301`, `303`, `307`, `308`).
   * @returns A redirect response or a `400` JSON error response.
   *
   * @example
   * ```ts
   * return res.redirect(String(req.query.next ?? "/"));
   * ```
   */
  redirect(url: string, status: number = 302): Response {
    const target = normalizeLocalRedirectTarget(url);
    if (target === null) return this._invalidRedirect();
    return this._redirectTo(target, status);
  }

  /**
   * Redirects to an explicit absolute `http:`/`https:` URL (external escape
   * hatch for OAuth-style flows).
   *
   * This is the only method that emits an off-origin `Location`, and only when
   * the target parses as an absolute `http:` or `https:` URL. Protocol-relative
   * (`//evil.test`), scheme (`javascript:`, `data:`), backslash, and relative
   * targets are rejected with `400` and the JSON body
   * `{"success":false,"error":"Invalid redirect target"}`; no `Location` header
   * is emitted. Accepted URLs are passed through as-is (no normalization);
   * control characters are stripped before the header is written.
   *
   * @param url - Absolute `http:`/`https:` destination.
   * @param status - Redirect status code; defaults to `302`.
   * @returns A redirect response or a `400` JSON error response.
   *
   * @example
   * ```ts
   * return res.redirectExternal(
   *   "https://accounts.example.com/oauth/authorize?client_id=app",
   * );
   * ```
   */
  redirectExternal(url: string, status: number = 302): Response {
    const target = normalizeExternalRedirectTarget(url);
    if (target === null) return this._invalidRedirect();
    return this._redirectTo(target, status);
  }

  /**
   * Redirects only to a safe origin-relative target.
   *
   * Kept for callers written against `0.1.3`; it is an alias of
   * {@link redirect}, which now applies the same validation by default.
   *
   * @param url - Origin-relative destination, for example `/dashboard`.
   * @param status - Redirect status code; defaults to `302`.
   * @returns A redirect response or a `400` JSON error response.
   */
  redirectLocal(url: string, status: number = 302): Response {
    return this.redirect(url, status);
  }

  /**
   * use fileserver to serve the file securely.
   */
  /** Serves the current request through the configured secure static file server. */
  async fileServer() {
    // ---  ---------------------------------------------------------------
    return this.staticServer.serve(this.req, this);
  }

  /**
   * Universal file handler supporting BunFile and raw Uint8Array.
   */
  /**
   * Sends a Bun file or byte array, with optional metadata and extra headers.
   * Bun files support byte range requests; byte arrays do not. A missing Bun
   * file returns `404`, and an invalid range returns `416`.
   *
   * @param file - File handle or bytes to send.
   * @param meta - MIME type and size metadata for a byte array.
   * @param extraHeaders - Additional headers to apply before sending.
   */
  async file(
    file: BunFile | Uint8Array,
    meta?: FileMeta,
    extraHeaders?: Heder | HeaderObject,
  ): Promise<Response> {
    if (extraHeaders) this.header(extraHeaders);

    const isBunFile = "slice" in file && "type" in file;

    // 1. Check if the BunFile actually exists on disk
    if (isBunFile && !(await (file as BunFile).exists())) {
      return this.error(404, "File Not Found");
    }

    const fileSize = isBunFile ? file.size : (meta?.size ?? 0);
    const fileType = isBunFile
      ? file.type
      : (meta?.type ?? "application/octet-stream");

    const baseHeaders = this._buildHeaders();
    if (!baseHeaders.has("Content-Type")) {
      baseHeaders.set("Content-Type", fileType);
    }
    if (!baseHeaders.has("Accept-Ranges")) {
      baseHeaders.set("Accept-Ranges", isBunFile ? "bytes" : "none");
    }

    const rangeHeader = isBunFile ? this.req.headers.get("range") : null;

    // --- Standard Request ---
    if (!rangeHeader) {
      let body: BodyInit = file as BodyInit;
      const finalHeaders = new Headers(baseHeaders);

      if (this._encoding && this._encoding !== "none") {
        try {
          // 2. Safely await arrayBuffer to catch permission/read errors
          const fileBuffer = isBunFile
            ? new Uint8Array(await file.arrayBuffer())
            : file;

          const { payload, encoding: enc } = Compressor.handle(
            fileBuffer,
            this._encoding,
          );

          body = payload as BodyInit;
          if (enc) finalHeaders.set("Content-Encoding", enc);
          finalHeaders.set("Content-Length", payload.length.toString());
        } catch (error) {
          return this.error(500, "Error reading file");
        }
      } else {
        finalHeaders.set("Content-Length", fileSize.toString());
      }

      return new Response(body, {
        status: this._code,
        headers: finalHeaders,
      });
    }

    // --- Range Request (BunFile only) ---
    const rangeNotSatisfiable = () => {
      const headers = this._buildHeaders();
      headers.set("Content-Range", `bytes */${fileSize}`);
      return new Response(null, { status: 416, headers });
    };

    const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!rangeMatch) return rangeNotSatisfiable();

    const rawStart = rangeMatch[1] ?? "";
    const rawEnd = rangeMatch[2] ?? "";

    let start: number;
    let end: number;

    if (rawStart === "") {
      // Suffix range: `bytes=-N` requests the final N bytes.
      const suffixLength = Number(rawEnd);
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        return rangeNotSatisfiable();
      }
      start = Math.max(fileSize - suffixLength, 0);
      end = fileSize - 1;
    } else {
      start = Number(rawStart);
      end = rawEnd === "" ? fileSize - 1 : Number(rawEnd);
    }

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start > end ||
      start >= fileSize
    ) {
      return rangeNotSatisfiable();
    }

    // RFC 9110: an end position beyond the representation is clamped to its last byte.
    end = Math.min(end, fileSize - 1);

    const rangeHeaders = new Headers(baseHeaders);
    rangeHeaders.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    rangeHeaders.set("Content-Length", (end - start + 1).toString());

    return new Response((file as BunFile).slice(start, end + 1), {
      status: 206,
      headers: rangeHeaders,
    });
  }

  /**
   * Builds the headers shared by every SSE response. SSE bodies are streamed
   * uncompressed, so a negotiated `Content-Encoding` (for example `br` from the
   * request's `Accept-Encoding`) is deliberately removed: advertising an
   * encoding the stream does not use makes browsers and Bun `fetch` fail to
   * decode the frames.
   */
  private _eventHeaders(): Headers {
    const headers = this._buildHeaders();
    headers.delete("Content-Encoding");
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "text/event-stream");
    }
    if (!headers.has("Cache-Control")) {
      headers.set("Cache-Control", "no-cache");
    }
    if (!headers.has("Connection")) {
      headers.set("Connection", "keep-alive");
    }
    return headers;
  }

  /**
   * Returns Server-Sent Events (SSE) response helpers.
   *
   * SSE keeps an HTTP response open so the server can push events to a client.
   * Use the returned helper that best fits the producer:
   *
   * - `asyncStream` consumes an async generator and emits each yielded value as
   *   a `data:` message. Objects are JSON-encoded; other values are stringified.
   * - `eStream` calls a push function on an interval and supports SSE `id`,
   *   `event`, `retry`, and end-of-stream fields in its returned payload.
   * - `readableStream` gives a producer the stream controller for fully manual
   *   framing and lifecycle control.
   *
   * Each helper returns a `text/event-stream` response and disables Bun's
   * request timeout for the current request. SSE frames are always sent
   * uncompressed: `Content-Encoding` is omitted even when the client advertises
   * `gzip`/`br`, so `EventSource` and `fetch` can decode the stream without a
   * header override. If this response builder was created without a Bun server,
   * its helpers return a `500` response.
   * Consumers can listen in browsers with `EventSource`; SSE is one-way, from
   * server to client. Use WebSockets when clients also need to send live data.
   */
  get event() {
    const disableTimeout = () => {
      // Prevents Bun from dropping long-lived connections
      this.server?.timeout(this.req.request, 0);
    };

    return {
      /**
       * Creates an SSE stream from an async generator.
       *
       * Every yielded value becomes one `data: ...` message followed by a blank
       * line. Objects are JSON-encoded; primitives are converted to strings.
       * Returning from the generator closes the stream. If the client
       * disconnects, the generator's `return()` method is called when present.
       *
       * @param generator - Factory that returns the async iterable of messages.
       * @returns An SSE response, or a `500` response when no Bun server is set.
       *
       * @example
       * ```ts
       * return res.event.asyncStream(async function* () {
       *   yield { status: "connected" };
       *   while (true) {
       *     yield { time: new Date().toISOString() };
       *     await new Promise((resolve) => setTimeout(resolve, 1000));
       *   }
       * });
       * ```
       */
      asyncStream: (
        generator: () => AsyncGenerator<any, void, unknown>,
      ): Response => {
        if (!this.server) return this.null(500);
        disableTimeout();

        const iter = generator();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of iter) {
                // Ensure the payload matches the standardized SSE string format
                const payload =
                  typeof chunk === "object"
                    ? JSON.stringify(chunk)
                    : String(chunk);
                controller.enqueue(Buffer.from(`data: ${payload}\n\n`));
              }
              controller.close();
            } catch (e) {
              controller.error(e);
            }
          },
          cancel() {
            iter.return?.();
          },
        });

        return new Response(stream, {
          headers: this._eventHeaders(),
        });
      },

      /**
       * Creates an interval-driven SSE stream.
       *
       * The callback returns a payload containing `data` and optional SSE
       * metadata (`id`, `event`, `retry`), an `end` flag, or an `fn` callback
       * whose result is passed to the next invocation. The interval is clamped
       * to at least one second. Setting `end: true` closes the stream before
       * emitting that callback's payload. On client disconnect, the interval
       * is cleared and `onCancel` is invoked.
       *
       * @param push - Produces the next event payload, optionally using the
       * previous `fn` result.
       * @param options - Interval in milliseconds and disconnect callback.
       * @returns An SSE response, or a `500` response when no Bun server is set.
       *
       * @example
       * ```ts
       * return res.event.eStream(
       *   () => ({ event: "heartbeat", data: { time: Date.now() } }),
       *   { interval: 5000 },
       * );
       * ```
       */
      eStream: (
        push: StreamPushFn,
        {
          interval = 2000,
          onCancel,
        }: { interval?: number; onCancel?: () => void } = {},
      ): Response => {
        if (!this.server) return this.null(500);
        disableTimeout();

        const ES = new eStream();
        const stream = new ReadableStream({
          async start(controller) {
            await ES.push(controller, push, interval);
          },
          cancel() {
            ES.close();
            onCancel?.();
          },
        });

        return new Response(stream, {
          headers: this._eventHeaders(),
        });
      },

      /**
       * Creates an SSE response with direct control over its stream controller.
       *
       * The producer is responsible for writing valid SSE frames (for example,
       * `data: hello\\n\\n`) and closing or erroring the controller when done.
       * `onCancel` runs if the client cancels or disconnects.
       *
       * @param producer - Writes to the response stream using its controller.
       * @param onCancel - Optional cleanup callback for client cancellation.
       * @returns An SSE response, or a `500` response when no Bun server is set.
       */
      readableStream: (
        producer: (
          controller: ReadableStreamDefaultController<any>,
        ) => void | Promise<void>,
        onCancel?: () => void,
      ): Response => {
        if (!this.server) return this.null(500);
        disableTimeout();

        const stream = new ReadableStream({
          async start(controller) {
            await producer(controller);
          },
          cancel() {
            onCancel?.();
          },
        });

        return new Response(stream, {
          headers: this._eventHeaders(),
        });
      },
    };
  }
}
