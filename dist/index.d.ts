import { Server, SocketAddress, BunFile, ServerWebSocket, WebSocketHandler, SQL } from 'bun';
import { McpServer, McpRequestContext } from '@modelcontextprotocol/server';
export { McpRequestContext, McpServer } from '@modelcontextprotocol/server';

/** Options accepted by {@link req.autoBody}. */
interface AutoBodyOptions {
    /**
     * Maximum accepted request-body size in bytes.
     *
     * @default 1048576 (1 MiB, the shared `DEFAULT_MAX_SIZE`)
     */
    maxSize?: number;
}
/** Content-type-aware body selected by {@link req.autoBody}. */
interface AutoBodyResult<T = unknown> {
    /**
     * Parsed body: an object/array for JSON, `FormData` for form content types,
     * or the raw string for anything else. `null` when the request had no body.
     */
    body: T | string | null;
    /** How the body was interpreted. */
    parsedWith: "json" | "form" | "text" | "empty";
}
declare class req {
    readonly request: Request;
    readonly server?: Server<unknown> | undefined;
    private readonly fileDetector;
    params: Record<string, string>;
    private _url?;
    private _query?;
    private _cookies?;
    private _formData?;
    private _json?;
    private _txt?;
    private _autoBody?;
    constructor(request: Request, server?: Server<unknown> | undefined, fileDetector?: (path: string) => boolean);
    /**
     * Caches the raw text.
     * By resolving text first, we prevent Bun's "body stream already locked" error
     * if you attempt to read .text() and .json() in the same request lifecycle.
     */
    text(): Promise<string>;
    /**
     * Parses JSON from the cached text to prevent stream locks.
     */
    json<T extends Record<string, any>>(): Promise<T>;
    /**
     * Parses FormData. Cannot be mixed with .text() or .json() for multipart binary uploads.
     */
    form(): Promise<FormData>;
    /**
     * Reads the request body using its `Content-Type`.
     *
     * - `application/json` (and `+json`) is parsed with `JSON.parse`; malformed
     *   JSON falls back to the raw text instead of throwing.
     * - Form content types return the cached `FormData`.
     * - Everything else returns the raw text.
     * - An empty body returns `body: null` and `parsedWith: "empty"`.
     *
     * The result is cached like {@link req.text}, so repeated calls do not re-read
     * the stream, and bodies larger than 1 MiB are rejected with an error instead
     * of being parsed. This makes it safe for lenient endpoints that accept
     * either JSON or form input:
     *
     * ```ts
     * const { body, parsedWith } = await req.autoBody();
     * ```
     *
     * @param options - Optional body-size cap.
     * @returns The selected body and how it was interpreted.
     */
    autoBody<T = unknown>(options?: AutoBodyOptions): Promise<AutoBodyResult<T>>;
    get url(): URL;
    get query(): Record<string, string>;
    get cookies(): Map<string, string>;
    get auth(): string | undefined;
    get method(): string;
    get headers(): Headers;
    /**
     * Helper to grab a specific header safely.
     */
    header(key: string): string | null;
    get ip(): SocketAddress | null;
    get path(): string;
    get isForm(): boolean;
    get isWSS(): boolean;
    get isEventStream(): boolean;
    /**
     * Infers if the route is a static file by checking for an extension in the last URL segment.
     */
    get isFile(): boolean;
    getAuthCredentials(): Promise<{
        sid: string;
        jwt: string;
        refresh: string;
    }>;
    upgrade<T = any>(data?: T): boolean;
}

type HeaderObject$1 = Record<string, string>;

declare class HeadBase {
    protected data: HeaderObject$1;
    constructor(initialData?: HeaderObject$1);
    protected _add(key: string, value: string): this;
    add(key: string, value: string): this;
}

/** * Layer 1: Security
 */
declare class SecurityHead extends HeadBase {
    /** * Prevents clickjacking by forbidding the page from being framed.
     * Options: 'DENY', 'SAMEORIGIN'
     */
    frameOptions(option?: "DENY" | "SAMEORIGIN"): this;
    /** * Forces browser to stick to the declared Content-Type.
     */
    noSniff(): this;
    /** * Forces HTTPS for a set duration (default 1 year).
     */
    hsts(maxAge?: number): this;
    /** * Basic CSP: Only allow scripts/styles from your own origin.
     */
    csp(policy?: string): this;
    /** Referrer policy for privacy */
    referrer(policy?: "no-referrer" | "origin" | "strict-origin-when-cross-origin"): this;
    /** * NEW: Cross-Origin Opener Policy (Isolates your tab from others)
     */
    coop(policy?: "same-origin" | "same-origin-allow-popups" | "unsafe-none"): this;
    /** * NEW: Cross-Origin Embedder Policy
     */
    coep(policy?: "require-corp" | "unsafe-none"): this;
    /** * Modern replacement for Feature-Policy.
     * e.g., "camera=(), microphone=()"
     */
    permissions(policy: string): this;
}

/** * Layer 2: Traffic (Extends SecurityHead)
 */
declare class Traffic extends SecurityHead {
    cors(origin?: string): this;
    cache(seconds?: number): this;
    noCache(): this;
    etag(val: string): this;
    /** * Set custom timing metrics for browser dev tools.
     */
    serverTiming(name: string, durMs: number, desc?: string): this;
    /** Sets standard rate limit headers */
    rateLimit(limit: number, remaining: number, resetSeconds: number): this;
    /** Sets the Retry-After header (useful for 429 or 503) */
    retryAfter(seconds: number | string): this;
    /**
     * Sets the date/time after which the response is considered stale.
     */
    expires(date: Date): this;
    /**
     * Indicates the date and time at which the resource was last modified.
     */
    lastModified(date: Date): this;
}

/** * Layer 3: Auth (Extends Traffic)
 */
declare class AuthHead extends Traffic {
    /** * Sets the WWW-Authenticate header for 401 responses.
     * e.g., head.authenticate("Bearer", "realm=\"access\"")
     */
    authenticate(scheme: "Bearer" | "Basic" | "Digest", details?: string): this;
    /** * Sets the Proxy-Authenticate header.
     */
    proxyAuthenticate(value: string): this;
}

type CommonMimeType = "text/plain" | "text/html" | "text/css" | "text/javascript" | "application/json" | "application/xml" | "application/x-www-form-urlencoded" | "multipart/form-data" | "audio/mpeg" | "video/mp4" | (string & {});
/** * Layer 3: Auth (Extends AuthHead)
 */
declare class Contents extends AuthHead {
    /**
     * Bulk setter for content headers.
     * Accepts an object where keys match semantic method names.
     */
    content(options: {
        length?: number;
        type?: CommonMimeType;
        encoding?: "gzip" | "deflate" | "br" | "identity" | "zstd";
        disposition?: {
            type: "inline" | "attachment";
            filename?: string;
        };
        language?: string;
        range?: string;
        location?: string;
        md5?: string;
    }): this;
    /** The size of the response body in bytes */
    contentLength(bytes: number): this;
    /** The MD5 hash of the body to verify data integrity */
    contentMD5(hash: string): this;
    /** content type */
    contentType(mime: CommonMimeType): this;
    /** * Defines the compression algorithm used.
     * Common: 'gzip', 'deflate', 'br' (Brotli)
     */
    contentEncoding(encoding: "gzip" | "deflate" | "br" | "identity" | "zstd"): this;
    /** * Where the content actually lives if this is a partial view
     * or a reference to another location.
     */
    contentLocation(url: string): this;
    /** Used to indicate the range of bytes in a partial response (Status 206) */
    contentRange(range: string): this;
    /** Specifies the security level or sensitivity of the content */
    contentSecurity(value: string): this;
    /** * Controls if content is displayed inline or as an attachment (download).
     * @param type 'inline' or 'attachment'
     * @param filename Optional name for the downloaded file
     */
    disposition(type?: "inline" | "attachment", filename?: string): this;
    /** Tells the client which request headers were used to decide the response */
    vary(...headers: string[]): this;
    /** Suggests a language for the content */
    language(lang: string): this;
}

/** * Layer 5: Auth (Extends Traffic)
 */
declare class Utils extends Contents {
    location(url: string): this;
    /**
     * Specifically sets the Access-Control-Allow-Origin header.
     */
    origin(value?: string): this;
    /**
     * The date and time at which the message was originated.
     */
    date(date?: Date): this;
    /**
     * Contains information about the software used by the origin server.
     */
    server(name: string): this;
    /**
     * Controls whether the network connection stays open after the transaction finishes.
     * Common: 'keep-alive', 'close'
     */
    connection(value: "keep-alive" | "close"): this;
    /**
     * Sets parameters for a persistent connection (timeout and max requests).
     * e.g., head.keepAlive("timeout=5, max=1000")
     */
    keepAlive(value: string | number): this;
    cookie(name: string, value: string, options?: CookieOptions): this;
}
interface CookieOptions {
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

/** *  Final Master Class (The one you actually use)
 */
declare class Heder extends Utils {
    /**
     * Creates a deep copy of the current builder for reuse.
     */
    get copy(): Heder;
    use(plugin: HederPlugin): this;
    merge(_heder: Heder | HeaderObject$1): this;
    static init(initial?: HeaderObject$1): Heder;
    static get $(): Heder;
    get done(): HeaderObject$1;
}
type HederPlugin = (h: Heder) => void;

/** A resolved session with both the framework methods and the user's data. */
type SessionInstance<TData extends Record<string, any> = Record<string, any>> = ServerSide<TData> & TData;
declare class ServerSide<TData extends Record<string, any> = Record<string, any>> {
    sid: string;
    data: TData;
    isNew: boolean;
    isModified: boolean;
    isReadOnly: boolean;
    isFound: boolean;
    length: number;
    /**
     * Rotation hook supplied by the session service.
     * @internal
     */
    private _rotator?;
    constructor(sid?: string, initialData?: Partial<TData>, readOnly?: boolean, isNew?: boolean, isFound?: boolean);
    /**
     * Generates the dynamic Proxy trapped instance.
     * We use `this & TData` so TypeScript knows this object contains both
     * the class methods AND the dynamic user data.
     */
    get session(): SessionInstance<TData>;
    /**
     * Registers the service callback used by {@link ServerSide.rotate}.
     * @internal
     */
    setRotator(rotator: () => Promise<void>): void;
    /**
     * Replaces this session's identifier in place.
     * @internal
     */
    renewSid(sid: string): void;
    /**
     * Rotates the session identifier (session-fixation defence).
     *
     * The previous row is deleted and this session receives a freshly signed
     * `sid`; the guard persists the new row and sends its cookie after the
     * handler returns. Call it after a successful login:
     *
     * ```ts
     * await ctx.session!.rotate();
     * ctx.session!.userId = user.id;
     * ```
     *
     * A readonly mount ignores rotation. Throws when the session was created
     * without a session service (for example a hand-built `new ServerSide()`).
     */
    rotate(): Promise<void>;
    /**
     * Rotates the session identifier and atomically replaces all session data.
     *
     * Use this after a successful login so no pre-authentication value survives:
     *
     * ```ts
     * await ctx.session!.reset({ userId: user.id, username: user.name });
     * ```
     *
     * The previous row is deleted and a fresh `sid` is issued, so the old cookie
     * is no longer usable. The guard persists the new row and sends its cookie
     * after the handler returns. Pass an empty object to end with no data (the
     * guard then deletes the new row and expires the cookie).
     *
     * A readonly mount ignores the reset.
     *
     * @param data - Complete replacement for the session data.
     */
    reset(data?: Partial<TData>): Promise<void>;
    /**
     * Removes every key from the session.
     *
     * After the handler returns the guard deletes the stored row and expires the
     * cookie, so the client is logged out. A readonly mount ignores the clear.
     *
     * ```ts
     * await ctx.session!.clear();
     * ```
     */
    clear(): Promise<void>;
}

declare class ctx<Args extends Record<string, string> = Record<string, string>, SessionType = ServerSide, BodyType = unknown> {
    readonly res: res;
    params: Args;
    /**
     * Custom header maker
     */
    headr: Heder;
    url: URL;
    data: Record<string, any>;
    jwtData: Record<string, any>;
    session?: SessionType;
    body?: BodyType;
    query: Record<string, string | string[] | undefined>;
    form: Record<string, any>;
    readonly req: req;
    method: string;
    methods: string[];
    clientDirectory: string;
    constructor(res: res);
}

type ErrorConfig = {
    /** HTTP status code used for the response. @default 400 */
    code?: number | undefined;
    /** Message returned in the JSON `error` field; defaults to the status text. */
    message?: string | undefined;
    /** Redirect target; when set the guard answers `302` instead of an error body. */
    redirect?: string | undefined;
    /**
     * Extra response headers merged into the response. Invalid header names are
     * dropped and CR/LF/NUL/other unserializable value characters are removed
     * before the response is built. CORS headers are **not** added automatically:
     * pass `Access-Control-Allow-Origin` here (or mount `cors`) when a browser must
     * read the error response.
     */
    headers?: Record<string, string> | undefined;
    error?: (ctx: ctx) => Response;
    maxSize?: number | undefined;
};
/**
 * Builds a JSON error response (`{ success: false, error, details? }`).
 *
 * Only headers supplied through `config.headers` are emitted (plus
 * `Content-Type`/`Location`); CORS headers are intentionally left to the `cors`
 * guard so a rejection cannot advertise a wildcard grant by itself. Opt in by
 * passing an explicit `Access-Control-Allow-Origin` header in the config.
 *
 * @param config - Status, message, optional headers, or redirect target.
 * @param details - Optional extra payload serialized under `details`.
 * @returns The error `Response`.
 */
declare function sendError(config: ErrorConfig, details?: any): Response;

type ContentEncodingType = "gzip" | "deflate" | "br" | "zstd" | "none";

interface StreamPayload {
    /** Provides a recovery ID for automatic reconnection tracking. */
    id?: string | number;
    /** Contains the actual payload (must be the last field in the packet). */
    data: string | Record<string, any>;
    /** Names the event so the client can use addEventListener('name', ...). */
    event?: string;
    /** Tells the client how many milliseconds to wait before reconnecting (default is 3000ms). */
    retry?: number;
    /** Forcefully end and close the stream. */
    end?: boolean;
    /** State function to return the value as an argument in the next interval. */
    fn?: () => any;
}
type StreamPushFn = (prevFnResult?: any) => StreamPayload;

/** Options accepted by {@link StaticFileServer}. */
interface StaticFileServerOptions {
    /**
     * Development mode: disables the ≤ 50 KB in-memory cache so an edited asset
     * is visible on the next request. Files above the threshold already bypass
     * the cache, so the flag has no effect on them.
     */
    dev?: boolean;
}
declare class StaticFileServer {
    private readonly absoluteClientPath;
    private readonly additionalExtensions;
    private readonly dev;
    private readonly SMALL_FILE_THRESHOLD;
    private readonly CACHE_TTL;
    constructor(resolvedAssetRootPath: string, additionalExtensions?: string[], options?: StaticFileServerOptions);
    isFile(path: string): boolean;
    /**
     * Builds the cache validator headers shared by every served file and reports
     * whether the client's `If-None-Match` already matches `etag` under RFC 9110
     * weak comparison (wildcard and comma-separated lists included).
     */
    private validators;
    /**
     * Builds a bodyless `304 Not Modified` response for validators that still
     * describe the client's copy. When the server negotiates a content encoding,
     * the 304 advertises `Vary: Accept-Encoding` exactly like the equivalent
     * `200`, so shared caches keep the negotiation dimension in their key.
     */
    private notModified;
    /**
     * Serves the request from this server's root.
     *
     * Files at or below 50 KB are buffered and kept in an in-memory cache; files
     * above it are streamed from disk on every request. Each cached entry is
     * revalidated with one cheap `stat()` per request: when the file's
     * modification time or size changed on disk, the entry is dropped and the
     * bytes are read again, so an edited asset is served immediately with a new
     * content-hash `ETag`. Entries also expire after the 15-minute TTL, as
     * before. With the `dev` option the in-memory cache is bypassed entirely and
     * every request reads fresh bytes.
     *
     * @param lookupPath - Optional already-decoded path to resolve instead of the
     * request pathname. Scoped mounts use it to serve a prefix-stripped path;
     * when omitted the request URL is decoded exactly as before.
     */
    serve(req: req, res: res, lookupPath?: string): Promise<Response>;
}

type HeaderObject = Record<string, string>;
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
declare function isLocalRedirectTarget(url: string): boolean;
interface RespoOptions {
    /** Compression encoding to apply to generated response bodies. */
    encoding?: ContentEncodingType;
}
interface FileMeta {
    /**
     * Byte length of a raw `Uint8Array` body. Used only when it is a non-negative
     * safe integer equal to the buffer's length; otherwise the real length wins.
     */
    size?: number;
    /** MIME type of a raw `Uint8Array` body. */
    type?: string;
    /**
     * Enables byte range requests for raw `Uint8Array` bodies. Bun files always
     * support ranges.
     */
    ranges?: boolean;
    /** Entity tag emitted as `ETag` and used for conditional requests. */
    etag?: string;
    /** Last modification time in epoch milliseconds, emitted as `Last-Modified`. */
    lastModified?: number;
}
/** Builds HTTP responses while retaining status, headers, and encoding settings. */
declare class res {
    readonly req: req;
    private readonly staticServer;
    private readonly server?;
    private _code;
    private _headers;
    private _cookies;
    private _encoding?;
    private _configuredEncoding?;
    /**
     * Creates a response builder for the current request.
     *
     * @param options - Optional response encoding settings.
     * @param req - The request context used by file serving and streaming helpers.
     * @param staticServer - Static file server used by {@link fileServer}.
     * @param server - Optional Bun server. Streaming helpers need it to disable
     * Bun's request timeout for the long-lived connection.
     */
    constructor(options: RespoOptions | undefined, req: req, staticServer: StaticFileServer, server?: Bun.Server<undefined> | undefined);
    /**
     * The encoding configured for this response (before per-request negotiation).
     */
    get configuredEncoding(): ContentEncodingType | undefined;
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
    status(code: number): this;
    /**
     * Sets the Content-Encoding header and internal state.
     */
    /**
     * Sets or clears the response content encoding.
     *
     * @param type - Encoding to use, or `"none"` to remove the encoding header.
     * @returns This response builder for chaining.
     */
    encode(type: ContentEncodingType): this;
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
    header(input: Heder | HeaderObject): this;
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
    setCookie(name: string, value: string, options?: CookieOptions): this;
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
    clearCookie(name: string, options?: CookieOptions): this;
    /**
     * Builds the response header set, appending every queued `Set-Cookie`
     * separately so multiple cookies survive the trip to `Response#headers`.
     */
    private _buildHeaders;
    private _assemble;
    /**
     * Creates a response with no body using the supplied status or current status.
     *
     * @param status - Optional status code for this response.
     */
    null(status?: number): Response;
    /** Serializes a value as JSON and returns an `application/json` response. */
    json(data: Record<string, any>): Response;
    /** Returns an HTML response with a UTF-8 content type. */
    html(body: string): Response;
    /** Returns a plain text response with a UTF-8 content type. */
    text(body?: string): Response;
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
    error(code: number, message: string | Record<string, any>): Response;
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
    success(code?: number, data?: any, message?: string): Response;
    /**
     * Builds the rejection response for an invalid redirect target: `400` with
     * `{"success":false,"error":"Invalid redirect target"}` and no `Location`.
     */
    private _invalidRedirect;
    /** Emits an empty redirect with a sanitized `Location` value. */
    private _redirectTo;
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
    redirect(url: string, status?: number): Response;
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
    redirectExternal(url: string, status?: number): Response;
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
    redirectLocal(url: string, status?: number): Response;
    /**
     * use fileserver to serve the file securely.
     */
    /** Serves the current request through the configured secure static file server. */
    fileServer(): Promise<Response>;
    /**
     * Sends a Bun file or byte array, with optional metadata and extra headers.
     *
     * Bun files always support byte ranges; raw byte arrays do so only when
     * `meta.ranges` is `true`. Range responses (`206`) are always sent
     * uncompressed (identity) and carry no `Content-Encoding`, even when the
     * response negotiated a compression encoding. The `Range` header may contain
     * a comma-separated list, but rossa serves only the first satisfiable entry as
     * a single `206` response; it does not implement `multipart/byteranges`. A
     * `Range` header with no satisfiable entry (including any range against an
     * empty representation) returns `416`.
     *
     * When `meta.etag`/`meta.lastModified` are supplied they are emitted as
     * validators and evaluated for conditional GETs before any range handling:
     * a matching `If-None-Match` (or `If-Modified-Since` without an
     * `If-None-Match` decision) returns `304`. `If-Range` is honored against
     * either validator; when the referenced validator is unavailable, `If-Range`
     * is ignored and the range is served. When the response body depends on
     * `Accept-Encoding`, full responses carry `Vary: Accept-Encoding`; `206`
     * slices are fixed and do not add it. A missing Bun file returns a
     * `404` JSON error envelope.
     *
     * @param file - File handle or bytes to send.
     * @param meta - Type, size, range, and validator metadata.
     * @param extraHeaders - Additional headers to apply before sending.
     */
    file(file: BunFile | Uint8Array, meta?: FileMeta, extraHeaders?: Heder | HeaderObject): Promise<Response>;
    /**
     * Builds the headers shared by every SSE response. SSE bodies are streamed
     * uncompressed, so a negotiated `Content-Encoding` (for example `br` from the
     * request's `Accept-Encoding`) is deliberately removed: advertising an
     * encoding the stream does not use makes browsers and Bun `fetch` fail to
     * decode the frames.
     */
    private _eventHeaders;
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
    get event(): {
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
        asyncStream: (generator: () => AsyncGenerator<any, void, unknown>) => Response;
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
        eStream: (push: StreamPushFn, { interval, onCancel, }?: {
            interval?: number;
            onCancel?: () => void;
        }) => Response;
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
        readableStream: (producer: (controller: ReadableStreamDefaultController<any>) => void | Promise<void>, onCancel?: () => void) => Response;
    };
}

declare const METHODS: readonly ["GET", "POST", "PUT", "HEAD", "DELETE", "PATCH", "EVENT", "OPTIONS"];
type methodsKeys = (typeof METHODS)[number];
type handlerGuard = {
    guards: any[];
    handler: Function;
};
type methodGuards = Partial<Record<methodsKeys, handlerGuard>>;
declare class Methods {
    [key: string]: any;
    /**
     * The GET method requests a representation of the specified resource.
     * Requests using GET should only retrieve data.
     */
    get?({ req, res }: ctx): Promise<Response> | Response;
    /**
     * The POST method is used to submit an entity to the specified resource,
     * often causing a change in state or side effects on the server.
     */
    post?({ req, res }: ctx): Promise<Response> | Response;
    /**
     * The PUT method replaces all current representations of the target
     * resource with the request payload.
     */
    put?({ req, res }: ctx): Promise<Response> | Response;
    /**
     * The HEAD method asks for a response identical to that of a GET request,
     * but without the response body.
     */
    head?({ req, res }: ctx): Promise<Response> | Response;
    /**
     * The DELETE method deletes the specified resource.
     */
    delete?({ req, res }: ctx): Promise<Response> | Response;
    /**
     * The OPTIONS method is used to describe the communication options
     * for the target resource (essential for CORS preflight).
     */
    options({ res, methods }: ctx): Response;
    /**
     * The PATCH method is used to apply partial modifications to a resource.
     */
    patch?({ req, res }: ctx): Promise<Response> | Response;
    /**
     * Specialized handler for Server-Sent Events (SSE).
     * Used for real-time, uni-directional streaming from server to client.
     */
    event?({ req, res }: ctx): Promise<Response> | Response;
}

type TopicPublishStatus = "sent" | "backpressured" | "dropped" | "oversize";
/**
 * Outcome of publishing one payload to one topic.
 *
 * `backpressured` maps Bun's `ws.publish()` returning `-1`: at least one peer's
 * outbound buffer is past Bun's drain threshold. It is a Bun-internal signal,
 * not an application-reachable branch: in-process peers read from their
 * sockets, so app code cannot force `-1` (see `ws.send()`/`drain` for the
 * observable backpressure path). It is not a testable manager result; the
 * union keeps it only because Bun can return it.
 */
interface TopicPublishResult {
    topic: string;
    status: TopicPublishStatus;
}
/** Options for {@link subManager.broadcast} / {@link WssManager.broadcastToTopics}. */
interface TopicBroadcastOptions {
    /**
     * Also deliver the frame to the publishing socket. Bun's `publish()`
     * excludes the publisher, so this sends one copy through `ws.send()` before
     * fanning out. Defaults to `false` (sender-exclusive, today's behavior).
     * When every target topic rejects the payload as oversize, the sender gets
     * no copy either.
     */
    includeSelf?: boolean;
}
/** One member of a WebSocket topic, as returned by `members()`/presence frames. */
interface TopicMember {
    /** Connection id assigned by `WSSMAN.register`. */
    id: string;
    /** Registration nickname, falling back to the identity's `nickname` and then `""`. */
    nickname: string;
    /** Identity id from the guard (`contextData.user`/`chatUser`/`principal`). */
    userId?: string;
}
/** Topic presence event names emitted when `WssConfig.presence` is enabled. */
type TopicPresenceEvent = "join" | "leave";
/**
 * Automatic presence frame: `{ type, topic, member, members }`.
 *
 * `member` is the socket that joined or left; `members` is the topic's member
 * list after the change (the joining socket included on `join`, the departed
 * socket excluded on `leave`).
 */
interface TopicPresenceFrame {
    type: TopicPresenceEvent;
    topic: string;
    member: TopicMember;
    members: TopicMember[];
}
declare class subManager {
    private ws;
    id: string;
    constructor(ws: ServerWebSocket<any>, nickname?: string);
    subscribe(topic: string): void;
    unsubscribe(topic: string): void;
    cleanup(): void;
    unregister(): void;
    setAdmin(topic: string): void;
    isAdmin(topic: string): boolean;
    isSubscribed(topic: string): boolean;
    setTopicConfig(topic: string, config?: WssConfig): void;
    /** Typed member list for a topic; see {@link WssManager.members}. */
    members(topic: string): TopicMember[];
    /**
     * Publishes to unique topics and returns Bun's outcome for each topic.
     *
     * Pass `{ includeSelf: true }` to also deliver the frame to this socket
     * (Bun's `publish()` otherwise excludes the publisher). The default is
     * sender-exclusive, matching the historical behavior and result shape.
     *
     * `backpressured` is Bun-internal (a peer past the outbound drain threshold)
     * and cannot be produced from application code; see `TopicPublishResult`.
     */
    broadcast(topics: string[], data: any, options?: TopicBroadcastOptions): TopicPublishResult[];
}
declare class WssManager {
    private connections;
    private topicConfigs;
    private topicRegistry;
    private memberTopics;
    private roomAdmins;
    /** Last queued history write per topic; replay awaits it before reading. */
    private historySaves;
    private defaultTopicConfig;
    /** 1. Lifecycle: Register/Unregister Connections */
    register(ws: ServerWebSocket<any>, nickname?: string): string;
    /**
     * Typed member list for a topic.
     *
     * Returns `{ id, nickname, userId? }` for every live connection subscribed
     * to `topic`, in join order. `nickname` is the registration nickname (or the
     * identity's nickname, or `""`); `userId` is the guard identity's id when it
     * attached one (otherwise the property is absent).
     */
    members(topic: string): TopicMember[];
    /** @deprecated Use {@link members}; kept for existing call sites. */
    getMemberDetails(topic: string): TopicMember[];
    private memberDetails;
    /** Get all topics a specific user is currently in */
    getUserTopics(id: string): string[];
    get(topic: string): TopicMember[];
    unregister(id: string): void;
    /** 2. Subscription Management */
    subscribe(id: string, topic: string): void;
    isSubscribed(id: string, topic: string): boolean;
    unsubscribe(id: string, topic: string): void;
    /** 3. Admin & Role Management */
    setAdmin(id: string, topic: string): void;
    isAdmin(id: string, topic: string): boolean;
    /** 4. Security & Config Helpers */
    isPayloadTooLarge(topic: string, byteLength: number): boolean;
    /** True when `topic` already has `maxClients` members. */
    isTopicFull(topic: string): boolean;
    /**
     * Returns the first candidate topic that is at capacity, or `null`.
     * Used by the pre-upgrade handshake check.
     */
    findFullTopic(topics: Iterable<string>): string | null;
    /** Helper to get the correct config for any topic */
    private getConfigForTopic;
    setTopicConfig(topic: string, config?: WssConfig): void;
    private presenceFor;
    /**
     * Emits one presence frame when the topic opted in.
     *
     * Delivery works around Bun's sender-exclusive `publish()`: for a join the
     * publishing socket is the new member, so it receives a direct copy after
     * the fan-out. For a leave the publisher is a remaining member, which also
     * needs the direct copy. Without presence config nothing is sent.
     */
    private emitPresence;
    private scheduleHistoryReplay;
    private replayHistory;
    private persistHistoryFrame;
    /** Broadcast to an array of topics */
    /**
     * Publishes an encoded payload to each unique topic within that topic's
     * configured byte limit.
     *
     * `oversize` is decided before publishing. Bun's `0` is reported as
     * `dropped`, a positive result as `sent`, and `-1` as `backpressured`.
     * `backpressured` is Bun-internal (a peer past the outbound drain threshold);
     * in-process app code cannot force it and no application branch or unit test
     * should depend on it.
     *
     * With `options.includeSelf`, the publishing socket also receives one copy
     * (`ws.send`) before the fan-out, unless every topic rejects the payload as
     * oversize. The returned `TopicPublishResult[]` describes the publish
     * outcomes only and is unchanged by the option.
     *
     * When the topic config has `history`, accepted frames are queued for
     * persistence in `broadcast()` order.
     */
    broadcastToTopics(ws: ServerWebSocket<any>, topics: string[], data: unknown, options?: TopicBroadcastOptions): TopicPublishResult[];
    /** Ensures all topics for a client are cleaned up on disconnect */
    cleanup(id: string): void;
}

declare const WSSMAN: WssManager;
/** Default number of stored frames replayed when a topic does not set `limit`. */
declare const DEFAULT_TOPIC_HISTORY_LIMIT = 50;
/**
 * Persistence adapter for {@link WssHistoryConfig}.
 *
 * The application owns the frame shape: whatever object or string it passes to
 * `broadcast()` is what Rossa hands to `save()` and, later, replays exactly as
 * `recent()` returned it.
 */
interface TopicHistoryStore {
    /**
     * Persists one accepted broadcast frame for a topic.
     *
     * Called after the frame passed the topic's payload-size check and the
     * optional `persist` filter. Return a promise to make writes asynchronous;
     * Rossa orders subsequent saves per topic and waits for them before replay.
     */
    save(topic: string, frame: unknown): Promise<void> | void;
    /**
     * Returns up to `limit` stored frames for a topic, **oldest → newest**.
     * Rossa sends them in the returned order on join (subject to `replay`).
     */
    recent(topic: string, limit: number): Promise<unknown[]>;
}
/**
 * Pluggable per-topic history/backlog.
 *
 * When configured, Rossa saves accepted broadcast frames (after the payload
 * check and the optional `persist` filter) and, by default, replays
 * `recent(topic, limit)` oldest → newest to a socket when it joins the topic.
 * Presence frames and replayed frames are never persisted.
 */
interface WssHistoryConfig {
    /** Persistence adapter that stores and later reads frames. */
    store: TopicHistoryStore;
    /**
     * Maximum number of frames requested from `store.recent()` on join.
     * Defaults to {@link DEFAULT_TOPIC_HISTORY_LIMIT} (`50`).
     */
    limit?: number;
    /**
     * Replay stored frames to a socket when it joins the topic. Defaults to
     * `true`; set `false` to persist without replaying.
     */
    replay?: boolean;
    /**
     * Filter deciding which accepted frames are persisted. Receives the frame
     * exactly as passed to `broadcast()`. Defaults to persisting every accepted
     * frame; returning `false` skips the frame.
     */
    persist?: (frame: unknown) => boolean;
}
/**
 * Per-topic presence frame switches.
 *
 * An object opts in to both event kinds; set a key to `false` to suppress it.
 */
interface WssPresenceOptions {
    /** Emit a `join` frame when a socket subscribes. Defaults to `true`. */
    join?: boolean;
    /** Emit a `leave` frame when a socket unsubscribes/cleans up. Defaults to `true`. */
    leave?: boolean;
}
interface WssConfig {
    /**
     * Maximum members in this topic. Checked before the HTTP upgrade for topics
     * returned by `Websocket.capacityTopics()` (over-capacity upgrades answer
     * `503`), and again by `subscribe()` as the late-join fallback.
     */
    maxClients?: number;
    /** Maximum broadcast payload bytes for this topic. */
    maxPayloadSize?: number;
    /**
     * Emit automatic `{ type: "join" | "leave", topic, member, members }`
     * presence frames for this topic. `true` enables both events;
     * `{ join?, leave? }` enables either selectively.
     *
     * Defaults to **off**: a topic without this option emits no extra frames, so
     * existing broadcasts and handshakes are byte-identical. Join frames are
     * delivered to the joining socket as well as the other members; leave frames
     * go to the remaining members after the departed socket is removed.
     */
    presence?: boolean | WssPresenceOptions;
    /**
     * Pluggable topic history/backlog. Accepted broadcast frames are saved
     * through `store` (subject to `persist`) and, unless `replay` is `false`,
     * replayed oldest → newest to joining sockets. Frames are replayed exactly
     * as `recent()` returned them, with `replay: true` **not** injected.
     *
     * Defaults to undefined: no persistence and no replay.
     */
    history?: WssHistoryConfig;
}
/** Fixed-window incoming message limit applied independently to each socket. */
interface WssMessageRateLimit {
    /** Maximum messages accepted from each connection during one window. */
    max: number;
    /** Fixed-window duration in milliseconds. */
    windowMs: number;
}
type wssMessage<T extends Record<string, any> = Record<string, any>> = {
    text: string;
    json: T;
    topic?: string | undefined;
};

/**
 * Data Bun keeps on a WebSocket connection after `WSSMAN.register` runs.
 *
 * `id` and `nickname` are added by registration, while `instance` and
 * `contextData` come from the router's upgrade payload. `contextData` is the
 * same object a guard populated as `ctx.data` before the handshake.
 */
interface WssSocketData {
    /** Connection id assigned by `WSSMAN.register`. */
    id: string;
    /** Display name passed to `WSSMAN.register` (usually the guard identity's nickname). */
    nickname?: string;
    /** Guard-populated `ctx.data` copied before the upgrade. */
    contextData?: Record<string, any>;
    /** Controller instance bound to this connection. */
    instance?: Websocket<any, any>;
}
/**
 * Base class for WebSocket controllers.
 *
 * @typeParam TData - Per-connection state stored on `this.data`.
 * @typeParam TIdentity - Guard-populated identity exposed as `this.user`
 * (resolved from `contextData.user`, `contextData.chatUser`,
 * `contextData.principal`, or `ws.data.user`). Defaults to
 * `Record<string, any>`, so untyped use keeps working.
 */
declare class Websocket<TData extends Record<string, any> = Record<string, any>, TIdentity = Record<string, any>> {
    ws: ServerWebSocket<WssSocketData>;
    manager: subManager;
    /** Data populated by WebSocket route guards before the connection upgrades. */
    contextData: Record<string, any>;
    data: TData;
    /**
     * Guard-populated identity resolved from the upgrade's `contextData`
     * (`user`, `chatUser`, or `principal`) or `ws.data.user`. Empty object when
     * no guard attached one. Available from `open()` onwards.
     */
    user: TIdentity;
    /**
     * Query string of the WebSocket handshake URL (for example
     * `/chat?room=lobby` → `room=lobby`). Captured by the default
     * {@link capacityTopics} implementation, so subclasses that override
     * `capacityTopics` should call `super.capacityTopics(ctx)` to keep it
     * populated.
     */
    query: URLSearchParams;
    constructor();
    /**
     * Topics whose `maxClients` should be checked before the HTTP upgrade.
     *
     * Override this to let Rossa reject an over-capacity handshake with `503`
     * instead of accepting a socket that cannot subscribe. The upgrade has not
     * happened yet, so `this.ws` and `this.manager` are not available; use the
     * `ctx` argument (guards have already populated `ctx.data`) or the instance's
     * `contextData`.
     *
     * Return an empty array (the default) when the topic is only known after the
     * handshake. In that case `subManager.subscribe()` still enforces
     * `maxClients` and throws `TopicCapacityError`.
     *
     * The default implementation also snapshots `ctx.url.searchParams` into
     * {@link query}; when you override it, call `super.capacityTopics(ctx)` if
     * you rely on `this.query`.
     *
     * Configure the topic's `maxClients` before the upgrade (module scope, a
     * guard, or `WSSMAN.setTopicConfig`) — `open()` has not run yet when this is
     * called.
     */
    capacityTopics(ctx: ctx): string[];
    open(): Promise<void> | void;
    message({ text, json, topic }: wssMessage): Promise<void> | void;
    /** Called when Bun has drained buffered outbound data for this connection. */
    drain(): Promise<void> | void;
    /**
     * Disconnect lifecycle hook, called by Rossa when Bun reports the socket
     * closed. Runs **before** `manager.cleanup()`, so subscriptions, topics and
     * admin flags are still readable here.
     *
     * This method is a notification callback, not a way to close the socket.
     * Use {@link terminate} (or `this.ws.close`) to close from application code.
     */
    onClose(code: number, reason: string): Promise<void> | void;
    /**
     * @deprecated Override {@link onClose} instead. This alias is still invoked
     * on disconnect when a subclass overrides `close()` without overriding
     * `onClose()`, and runs before `manager.cleanup()`.
     */
    close(code: number, reason: string): Promise<void> | void;
    /**
     * Closes this connection from application code.
     *
     * Bun then reports the close, so `onClose(code, reason)` runs first and
     * `manager.cleanup()` follows. Defaults to a normal `1000` closure.
     */
    terminate(code?: number, reason?: string): void;
    set send(message: string | Bun.BufferSource);
}

/**
 * Router entry
 * @param basePath - /url/:hello
 * @returns
 */
declare function route(basePath?: string): <TTarget extends abstract new (...args: any[]) => Methods>(target: TTarget, context: ClassDecoratorContext<any>) => void | TTarget;
/**
 * Router entry
 * @param basePath - /url/:hello
 * @returns
 */
declare function wss(basePath?: string): <TTarget extends abstract new (...args: any[]) => Websocket<Record<string, any>, Record<string, any>>>(target: TTarget, context: ClassDecoratorContext<any>) => void | TTarget;

type GuardFactoryHandler<TOptions = void, ExtraCfg = Record<string, any>> = (ctx: ctx, next: () => Promise<Response> | Response, options: TOptions, Config: ErrorConfig & ExtraCfg) => Promise<Response>;
type GuardConfig = ErrorConfig & {
    id?: string | undefined;
};
/**
 * Per-call guard error configuration. Any field that is provided overrides the
 * factory default; omitted fields keep the default (or `400` for `code`).
 */
type BaseConfig = ErrorConfig;
type GuardReturnType = {
    (ctx: ctx, next: () => Promise<Response> | Response): Promise<Response>;
    _middlewareId: string;
    id: string;
};
/**
 * Creates a guard factory that merges a shared default error config with a
 * per-call override.
 *
 * The override wins for every field it defines (`code` included); omitted
 * fields fall back to the default, and `code` finally defaults to `400`.
 * `message` defaults to `"Request Failed"` and `headers` are shallow-merged.
 *
 * @param handler - Guard body invoked with the merged error config.
 * @param defaultConfig - Factory-wide id and default error config.
 * @returns A guard factory accepting `(options?, overrideConfig?)`.
 */
declare function createGuard<TOptions = void, ExtraCfg = Record<string, unknown>>(handler: GuardFactoryHandler<TOptions, ExtraCfg>, defaultConfig?: GuardConfig): (options?: TOptions, overrideConfig?: BaseConfig) => GuardReturnType;

type Class = new (...args: any[]) => any;
type RouteHandler = (ctx: ctx) => Promise<Response> | Response;
interface WssBaseController {
    open?(ws: any): void;
    message(ws: any, message: string | Uint8Array): void;
    close?(ws: any, code: number, reason: string): void;
}
interface WssRouteConfig {
    path: string;
    regex: RegExp;
    paramNames: string[];
    instance: typeof Websocket<{}>;
    guards: GuardReturnType[];
}
interface HttpRouteConfig {
    path: string;
    regex: RegExp;
    controller: Class;
    methods: methodGuards;
    methodKeys: string[];
    paramNames: string[];
}
interface HttpRouteMatch extends Partial<handlerGuard> {
    controller?: Class;
    methodKeys?: string[];
    params: Record<string, string>;
}
declare class RouterManager {
    protected globalBasePath: string;
    httpRoutes: HttpRouteConfig[];
    wssRoutes: WssRouteConfig[];
    protected globalGuards: any[];
    private registeredSignatures;
    private programmaticRoutes;
    constructor(globalBasePath?: string);
    use(...guards: GuardReturnType[]): void;
    private fullRoutePath;
    private compiler;
    private checkSignature;
    registerWSS(...ControllerClass: (typeof Websocket<{}>)[]): void;
    register(...ControllerClass: (typeof Methods)[]): void;
    /**
     * Registers a programmatic HTTP route without a decorated controller class.
     * Used by framework features such as MCP endpoints; a matching programmatic
     * route can be replaced, while a decorated HTTP route at the same path is a
     * collision.
     */
    protected registerHandlerRoute(path: string, handlers: Partial<Record<methodsKeys, RouteHandler>>, options?: {
        replace?: boolean;
    }): void;
    protected matchWSS(url: string): Partial<WssRouteConfig & {
        params: HttpRouteMatch["params"];
    }>;
    protected match(method: methodsKeys, url: string): HttpRouteMatch;
    printRoutes(): void;
    /** Returns registered HTTP paths, including the base path, with parameter colons removed. */
    getPaths(): string[];
}

/**
 * Base class for decorator-driven MCP endpoints.
 *
 * The framework creates a fresh `McpServer` for each request (named after the
 * controller class) and calls {@link McpController.build} before serving it.
 * Combine it with the `@mcp("/path")` decorator and register it with
 * `app.registerMCP(MyController)`.
 */
declare abstract class McpController {
    /**
     * Builds the MCP server: register tools, resources, and prompts here.
     * Runs once per request via the SDK factory, so async setup is supported.
     */
    abstract build(server: McpServer): void | Promise<void>;
}

/**
 * Produces a fresh MCP server for one HTTP exchange. Under the SDK's v2
 * handler the factory runs once per request, so per-request tools are possible.
 * Zero-argument factories remain assignable.
 */
type McpServerFactory = (context: McpRequestContext) => McpServer | Promise<McpServer>;
interface McpOptions {
    /**
     * Allowed browser `Origin` values. Entries may be full origins
     * (`https://app.example.com`), plain hostnames (`app.example.com`), or
     * scheme wildcards (`https://*`, `http://*`, `moz-extension://*`). Full
     * origins are matched exactly (scheme, host, and port); hostnames are
     * matched port-agnostically, in either scheme.
     *
     * A scheme wildcard allows every origin that uses that scheme: `https://*`
     * admits any https origin but not http, and `http://*` the reverse. Rossa
     * matches the `http`/`https` forms itself because the underlying MCP SDK
     * wildcard rule only covers non-web schemes; extension wildcards such as
     * `moz-extension://*` are validated by the SDK as before.
     *
     * Requests without an `Origin` header always pass, as non-browser MCP
     * clients do not send one. When omitted, Origin validation is disabled;
     * production apps should set this or use the CORS and IP guards.
     */
    origin?: string | string[];
}

/**
 * Marks an {@link McpController} subclass as an MCP endpoint.
 *
 * @param path - MCP endpoint path, resolved under the app's `basePath`.
 * @param options - Optional MCP endpoint settings such as allowed origins.
 * @returns A class decorator, used as `@mcp("/mcp")`.
 */
declare function mcp(path?: string, options?: McpOptions): <TTarget extends abstract new (...args: any[]) => McpController>(target: TTarget, context: ClassDecoratorContext<any>) => void | TTarget;

interface dev {
    path?: string;
    hostname?: string;
    method?: string;
    port?: number;
}
interface serverOptions {
    server: Partial<Bun.Serve.Options<any, never>> & dev & {
        /**
         * Called after Bun has bound the server, so `port` is the port actually
         * in use (including an OS-assigned ephemeral port when `port: 0`).
         *
         * The second argument is the bound `Bun.Server`; its `url` reflects the
         * effective host, port, and `https` scheme when `tls` is set.
         */
        fn?: (port: number, server: Bun.Server<any>) => void;
    };
    wss?: RossaWebSocketOptions | undefined;
}
type RossaWebSocketOptions = Partial<WebSocketHandler<any>> & {
    /** Optional fixed-window incoming message limit applied separately per socket. */
    messageRateLimit?: WssMessageRateLimit;
};
interface RossaOptions {
    basePath?: string;
    clientPath?: string;
    dirPath?: string;
    /** Additional static-file extensions to recognize, with or without a leading dot. */
    fileExtensions?: string[];
    logError?: boolean | undefined;
    Encoding?: ContentEncodingType;
}
declare class Rossa extends RouterManager {
    protected options: Omit<Required<RossaOptions>, "fileExtensions">;
    fileServer: StaticFileServer;
    private clientRoot;
    constructor(options?: RossaOptions);
    /**
     * Mounts an MCP server over Streamable HTTP.
     *
     * Use the decorator idiom for controllers:
     * ```ts
     * @mcp("/mcp")
     * class MyMcp extends McpController {
     *   build(server: McpServer) { ... }
     * }
     * app.registerMCP(MyMcp);
     * ```
     *
     * A raw per-request factory remains available when an explicit path is
     * supplied: `app.registerMCP("/mcp", () => new McpServer(...))`.
     *
     * Decorator-provided options are merged with per-call options; a per-call
     * `origin` wins. Global guards added with `use(...)` run before the MCP
     * handler. Registering the same path again replaces the previous MCP route.
     *
     * @param controller - A decorated `McpController` class or instance.
     * @param options - Optional per-call MCP settings.
     */
    registerMCP(controller: McpController, options?: McpOptions): void;
    registerMCP(controller: new () => McpController, options?: McpOptions): void;
    /**
     * Mounts a raw MCP factory at an explicit path.
     *
     * @param path - MCP endpoint path, for example `/mcp`.
     * @param factory - Produces the `McpServer` served for each request.
     * @param options - Optional allowed browser origins.
     */
    registerMCP(path: string, factory: McpServerFactory, options?: McpOptions): void;
    private mountMcp;
    private get getClientRoot();
    private pipeline;
    private processRouter;
    private processWSS;
    test(req: Request, encoding?: ContentEncodingType): Promise<Response>;
    /**
     * Starts a Bun server for the app.
     *
     * Server options are passed directly (`port`, `hostname`, `tls`, ...). The
     * returned `Bun.Server` is already bound. When `fn` is supplied it runs after
     * binding and receives the bound port and server, so `port: 0` resolves to
     * the OS-assigned port. Without `fn`, the startup log prints the bound URL
     * (`server.url`), including `https` when `tls` is configured.
     *
     * @param server - Bun serve options plus the optional `fn` ready callback.
     * @param wss - Optional WebSocket handler options and message rate limit.
     * @returns The bound `Bun.Server` instance.
     */
    serve(server?: serverOptions["server"], wss?: serverOptions["wss"]): Bun.Server<undefined>;
    protected errorHandler(res: res, error: any): Response;
}

type ColumnType = "text" | "integer" | "bigint" | "boolean" | "json" | "timestamp" | "serial" | "numeric";
/** Logical column definition interpreted by the selected database dialect. */
declare class Column {
    readonly type: ColumnType;
    readonly precision?: number | undefined;
    readonly scale?: number | undefined;
    primaryKey: boolean;
    required: boolean;
    isUnique: boolean;
    isAutoIncrement: boolean;
    hasDefault: boolean;
    defaultIsCurrentTimestamp: boolean;
    defaultValue: string | number | boolean | null;
    constructor(type: ColumnType, precision?: number | undefined, scale?: number | undefined);
    get primary(): this;
    get notNull(): this;
    get unique(): this;
    /**
     * Request a database-generated, never-reused value for this column.
     *
     * SQLite emits `PRIMARY KEY AUTOINCREMENT` (the column must be the primary
     * key); PostgreSQL renders `GENERATED BY DEFAULT AS IDENTITY` for plain
     * integer columns (`SERIAL` already increments); MySQL adds `AUTO_INCREMENT`.
     */
    autoIncrement(): this;
    get defaultNow(): this;
    default(value: string | number | boolean): this;
}
declare const t: {
    text: () => Column;
    int: () => Column;
    bigint: () => Column;
    boolean: () => Column;
    json: () => Column;
    timestamp: () => Column;
    serial: () => Column;
    numeric: (precision?: number, scale?: number) => Column;
};

declare class DatabaseError extends Error {
    constructor(message: string);
}
declare class UniqueConstraintError extends DatabaseError {
    constructor(message: string);
}
declare class ForeignKeyError extends DatabaseError {
    constructor(message?: string);
}

type DbDialectName = "sqlite" | "postgres" | "mysql" | "mariadb";
interface TableStats {
    rowCount: number;
    diskSize: string;
    indexCount: number;
}
/** Operations whose SQL differs between database engines. */
interface DbDialectAdapter {
    readonly name: DbDialectName;
    quoteIdentifier(name: string): string;
    quoteTable(name: string): string;
    normalizeColumnName(name: string): string;
    buildColumn(name: string, column: Column): string;
    buildColumnType(column: Column): string;
    normalizeOperator(operator: string): string;
    version(db: SQL): Promise<string>;
    createTable(db: SQL, schema: DbSchema<any>): Promise<void>;
    /** Render an (ideally idempotent) `CREATE INDEX` statement for a schema index. */
    createIndexSQL(table: string, index: DbSchemaIndex): string;
    /** Apply one schema index, skipping it when it already exists. */
    createIndex(db: SQL, schema: DbSchema<any>, index: DbSchemaIndex): Promise<void>;
    getColumns(db: SQL, schema: DbSchema<any>): Promise<string[]>;
    addColumn(db: SQL, schema: DbSchema<any>, name: string, type: string): Promise<void>;
    dropColumn(db: SQL, schema: DbSchema<any>, name: string): Promise<void>;
    upsert<T extends Record<string, any>>(db: SQL, schema: DbSchema<T>, data: T, conflictColumn: keyof T): Promise<T | undefined>;
    listTables(db: SQL): Promise<string[]>;
    dropTable(db: SQL, schema: DbSchema<any>): Promise<void>;
    truncateTable(db: SQL, schema: DbSchema<any>): Promise<void>;
    getTableStats(db: SQL, schema: DbSchema<any>): Promise<TableStats>;
    getTableIndices(db: SQL, schema: DbSchema<any>): Promise<any[]>;
    getTableSchema(db: SQL, schema: DbSchema<any>): Promise<any[]>;
    getTableData(db: SQL, schema: DbSchema<any>, limit: number, offset: number): Promise<any[]>;
    optimize(db: SQL, schema: DbSchema<any>): Promise<void>;
}

/** A secondary index declared alongside a table definition. */
interface DbSchemaIndex {
    readonly name: string;
    readonly columns: string[];
    readonly unique?: boolean;
}
/** Optional `DbSchema` configuration. */
interface DbSchemaOptions {
    /** Secondary indexes created together with the table. */
    readonly indices?: readonly DbSchemaIndex[];
}
declare class DbSchema<T extends Record<string, any>> {
    readonly table: string;
    private readonly definitions;
    readonly dialect: DbDialectAdapter;
    private readonly indexDefinitions;
    constructor(table: string, definitions: Record<keyof T, Column>, dialect: DbDialectAdapter, options?: DbSchemaOptions);
    entries(): Array<[string, Column]>;
    /** Secondary indexes declared for this table. */
    get indices(): DbSchemaIndex[];
    withDialect(dialect: DbDialectAdapter): DbSchema<T>;
    /** The `CREATE TABLE IF NOT EXISTS` statement for this schema. */
    createTableSQL(adapter?: DbDialectAdapter): string;
    /** Idempotent `CREATE INDEX` statements for the declared indexes. */
    createIndexSQLs(adapter?: DbDialectAdapter): string[];
    /** Every DDL statement needed to create the table and its indexes. */
    createStatements(adapter?: DbDialectAdapter): string[];
    createSQL(adapter?: DbDialectAdapter): string;
    columnDefinitions(adapter?: DbDialectAdapter): Record<string, string>;
    get columns(): {
        [K in keyof T]: string;
    };
}

/** Shared inspection API; SQL-specific operations live in the dialect adapter. */
declare class DbInspector<T extends Record<string, any>> {
    private readonly db;
    readonly schema: DbSchema<T>;
    constructor(db: SQL, schema: DbSchema<T>);
    listTables(): Promise<string[]>;
    dropTable(): Promise<void>;
    truncateTable(): Promise<void>;
    getTableStats(): Promise<TableStats>;
    getTableIndices(): Promise<any[]>;
    getTableSchema(): Promise<any[]>;
    getTableData(limit?: number, offset?: number): Promise<any[]>;
    optimize(): Promise<void>;
    static sqlite<T extends Record<string, any>>(db: SQL, schema: DbSchema<T>): DbInspector<T>;
    static postgres<T extends Record<string, any>>(db: SQL, schema: DbSchema<T>): DbInspector<T>;
}

type Where<T> = {
    [K in keyof T]?: T[K] | {
        operator: string;
        value: unknown;
    };
};
/** Options accepted by {@link DbRepository.findMany}. */
interface FindManyOptions<T> {
    /** Row filter; keyword operators are the same ones `findAll` accepts. */
    where?: Where<T>;
    /** Ordering column and direction (`asc` by default). */
    orderBy?: {
        column: keyof T & string;
        direction?: "asc" | "desc";
    };
    /** Maximum number of rows to return; must be a positive safe integer. */
    limit?: number;
}
/** Shared CRUD repository. Dialect-specific statements are delegated to its adapter. */
declare class DbRepository<T extends Record<string, any>> {
    private readonly db;
    readonly schema: DbSchema<T>;
    constructor(db: SQL, schema: DbSchema<T>);
    private get dialect();
    get inspect(): DbInspector<T>;
    withContext(context: SQL): DbRepository<T>;
    create(): Promise<void>;
    testConnection(): Promise<string>;
    syncColumns(allowDrop?: boolean): Promise<void>;
    private identifier;
    private get table();
    private joinSql;
    private buildWhere;
    insert(data: T): Promise<T | undefined>;
    upsert(data: T, conflictColumn: keyof T): Promise<T | undefined>;
    find(where: Where<T>): Promise<T | null>;
    findAll(where?: Where<T>): Promise<T[]>;
    /**
     * Read rows with optional filtering, ordering, and a row limit.
     *
     * Column names are validated against the schema, and the sort direction must
     * be `"asc"` or `"desc"`, so neither can inject SQL. This is the dialect-
     * neutral way to ask for a "latest N rows" slice, e.g.
     * `findMany({ where: { topic }, orderBy: { column: "id", direction: "desc" }, limit: 50 })`.
     *
     * @param options.where   Optional equality/operator filter.
     * @param options.orderBy Column and direction to sort by.
     * @param options.limit   Positive integer cap on returned rows.
     */
    findMany(options?: FindManyOptions<T>): Promise<T[]>;
    count(where?: Where<T>): Promise<number>;
    exists(where: Where<T>): Promise<boolean>;
    paginate(page: number, limit: number, where?: Where<T>): Promise<T[]>;
    update(where: Where<T>, data: Partial<T>): Promise<T[]>;
    delete(where: Where<T>): Promise<T[]>;
    transaction<R>(callback: (repository: DbRepository<T>, tx: SQL) => Promise<R>): Promise<R>;
    private handleDbError;
}

declare function getDialect(name: DbDialectName): DbDialectAdapter;

declare const postgresDialect: DbDialectAdapter;

declare const sqliteDialect: DbDialectAdapter;

declare const mysqlDialect: DbDialectAdapter;
declare const mariadbDialect: DbDialectAdapter;

/** Journal mode requested for a SQLite connection. In-memory databases stay in "memory" mode. */
type SqliteJournalMode = "WAL" | "DELETE" | "TRUNCATE" | "PERSIST" | "MEMORY" | "OFF";
/** Durability level for committed transactions. "NORMAL" is the usual companion to WAL. */
type SqliteSynchronous = "FULL" | "NORMAL" | "OFF";
/** Where SQLite keeps temporary tables and sort spills. */
type SqliteTempStore = "MEMORY" | "FILE" | "DEFAULT";
/** Setup options applied by `configureSqlite` / `createSqliteDatabase`. */
interface SqliteConfigOptions {
    /** Journal mode to request. Default "WAL". In-memory databases always report "memory". */
    journalMode?: SqliteJournalMode;
    /** Durability level. Default "NORMAL" (safe with WAL; loses only the last commits on power loss). Use "FULL" for maximum durability. Never "OFF". */
    synchronous?: SqliteSynchronous;
    /** Milliseconds a connection waits on a locked database before failing. Default 5000. */
    busyTimeoutMs?: number;
    /** Enforce declared foreign keys. Default true. */
    foreignKeys?: boolean;
    /** Per-connection page cache. Negative = KiB budget (default -32000 ≈ 31.25 MiB), positive = pages. Nonzero integer. */
    cacheSizeKiB?: number;
    /** Optional temp store. Undefined = leave SQLite default (benchmark before enabling MEMORY). */
    tempStore?: SqliteTempStore;
}
/** Effective SQLite settings read back after configuration. */
interface SqliteConnectionInfo {
    /** Effective journal mode as SQLite reports it (lowercase, e.g. "wal"). */
    journalMode: string;
    /** Effective `synchronous` value: 0 = OFF, 1 = NORMAL, 2 = FULL, 3 = EXTRA. */
    synchronous: number;
    /** Effective busy timeout in milliseconds. */
    busyTimeoutMs: number;
    /** Whether declared foreign keys are enforced. */
    foreignKeys: boolean;
    /** Configured page-cache setting (negative = KiB budget, positive = pages). */
    cacheSizeKiB: number;
    /** Database page size in bytes. */
    pageSize: number;
    /** Current number of database pages. */
    pageCount: number;
}
/** An open SQLite connection returned by `createSqliteDatabase`. */
interface SqliteConnection {
    /** The Bun SQL client connected to this database. */
    db: SQL;
    /** Absolute database path, or ":memory:" for in-memory databases. */
    filename: string;
    /** Effective settings read back during setup. */
    info: SqliteConnectionInfo;
    /** Close the underlying connection. */
    close(): Promise<void>;
}
/**
 * Apply SQLite PRAGMAs to an existing connection and report the effective
 * values. WAL, NORMAL durability, foreign keys, and a busy timeout make a
 * connection suitable for a typical local application database.
 */
declare function configureSqlite(db: SQL, options?: SqliteConfigOptions): Promise<SqliteConnectionInfo>;
/**
 * Open a SQLite database through Bun SQL, creating its parent directory, and
 * apply the recommended PRAGMAs. Pass ":memory:" for a throwaway database.
 */
declare function createSqliteDatabase(filename: string, options?: SqliteConfigOptions): Promise<SqliteConnection>;
/**
 * Run SQLite's integrity check and report whether the database is healthy.
 * Corruption details are returned in `messages`.
 */
declare function sqliteIntegrityCheck(db: SQL): Promise<{
    ok: boolean;
    messages: string[];
}>;
/**
 * Checkpoint the write-ahead log, flushing WAL pages back into the main
 * database file. "PASSIVE" never blocks ongoing readers or writers.
 */
declare function sqliteWalCheckpoint(db: SQL, mode?: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE"): Promise<{
    busy: number;
    log: number;
    checkpointed: number;
}>;

declare function use(...middlewares: GuardReturnType[]): <TTarget, TCtx extends ClassDecoratorContext<any> | ClassMethodDecoratorContext<any, any>>(target: TTarget, context: TCtx) => void | TTarget;

/**
 * Creates a guard that validates a bearer token from the `Authorization` header.
 *
 * @param validator - Checks the request context and extracted bearer token.
 * @returns A guard factory that accepts a validator and optional error configuration.
 */
declare const authBearer: (options?: ((ctx: ctx, token?: string) => Promise<boolean> | boolean) | undefined, overrideConfig?: BaseConfig) => GuardReturnType;
/**
 * Creates a guard that validates an API key from the `x-api-key` header.
 *
 * @param validator - Checks the request context and extracted API key.
 * @returns A guard factory that accepts a validator and optional error configuration.
 */
declare const apiKey: (options?: ((ctx: ctx, key?: string) => Promise<boolean> | boolean) | undefined, overrideConfig?: BaseConfig) => GuardReturnType;
/**
 * Creates a guard that validates one or more request headers.
 *
 * Each entry in the validator map uses a header name as its key and a callback
 * that validates that header's value.
 *
 * @param validator - Map of header names to validation callbacks.
 * @returns A guard factory that accepts validators and optional error configuration.
 */
declare const auth: (options?: Record<string, (ctx: ctx, keyValue?: string) => Promise<boolean> | boolean> | undefined, overrideConfig?: BaseConfig) => GuardReturnType;
/**
 * Checks whether the authenticated request may access a route.
 *
 * Use this after an authentication guard has established the identity in
 * `ctx`, then check roles, ownership, scopes, or other application policy in
 * the callback. A failed check returns HTTP 403 by default.
 *
 * @param canAccess - Synchronous or asynchronous authorization check.
 * @returns A guard factory that accepts the check and optional error config.
 */
declare const authorize: (options?: ((ctx: ctx) => Promise<boolean> | boolean) | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

interface CacheOptions {
    ttlMs: number;
}
/**
 * Caches public, successful GET responses by their full URL for the configured
 * lifetime. Requests carrying cookies or authorization headers bypass the cache.
 */
declare const smartCache: (options?: CacheOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

/**
 * Rule parameter: a single MIME type string, an array, or a custom validator function.
 * @example 'application/json'
 * @example ['application/json', 'multipart/form-data']
 * @example (ct, ctx) => ct?.startsWith('application/') ?? false
 */
type ContentTypeRules = string | string[] | ((contentType: string | null, ctx: ctx) => boolean);
/**
 * `contentType` — validates that the request `Content-Type` matches allowed types.
 *
 * @example
 * @Use(contentType('application/json'))
 * @Post('/upload')
 * upload(ctx: RossaContext) { ... }
 */
declare const contentType: (options?: ContentTypeRules | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

/**
 * Requires the named cookie to be present on the request.
 *
 * @param name - Cookie name to look up in the request's Cookie header.
 * @returns A guard factory that continues when the cookie exists.
 */
declare const cookies: (options?: string | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

interface CorsOptions {
    /**
     * Allowed origin(s). Can be "*", exact origin URLs, or an array of them,
     * or a custom validator function.
     * @default "*"
     */
    origin?: string | string[] | ((incomingOrigin: string | null, ctx: ctx) => string | boolean);
    /**
     * Headers allowed in requests (Access-Control-Allow-Headers).
     * @default "*"
     */
    allowHeaders?: string | string[];
    /** Methods advertised for browser preflight requests. */
    methods?: string | string[];
    /**
     * Headers exposed to the browser client (Access-Control-Expose-Headers).
     */
    exposeHeaders?: string | string[];
    /**
     * Whether to allow credentials like cookies or Authorization headers.
     * @default false
     */
    credentials?: boolean;
    /**
     * Preflight cache duration in seconds (Access-Control-Max-Age).
     * @default 86400 (24 hours)
     */
    maxAge?: number | string;
}
/**
 * Sets CORS response headers and rejects requests whose origin is not allowed.
 *
 * @param options - Allowed origins, headers, credentials, and preflight caching.
 * @returns A guard factory that accepts CORS options and optional error config.
 */
declare const cors: (options?: CorsOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

interface CsrfOptions {
    /** Request header compared with the `csrf_token` cookie. Default: `x-csrf-token`. */
    headerName?: string;
    /**
     * Token source for unsafe requests.
     *
     * - `"header"` (default) compares the configured request header with the
     *   `csrf_token` cookie.
     * - `"double-submit"` compares a JSON or form body field with the cookie. A
     *   supplied header must still match the cookie when it is present.
     */
    mode?: "header" | "double-submit";
    /**
     * Body field read in `"double-submit"` mode. Default: `csrf_token`.
     */
    bodyField?: string;
}
/** Options accepted by {@link csrf.issue}. */
interface CsrfIssueOptions extends CookieOptions {
    /** Cookie that stores the token. Default: `csrf_token`. */
    cookieName?: string;
    /** Explicit token value. Default: a freshly minted random UUID. */
    value?: string;
}
/** Result of {@link csrf.issue}. */
interface CsrfIssuedToken {
    /** The minted (or explicitly supplied) token. */
    token: string;
    /** The serialized `Set-Cookie` value for the token. */
    cookie: string;
}
/**
 * Mints a random CSRF token and serializes its cookie.
 *
 * When the response builder exposes {@link res.setCookie} the cookie is also
 * written through, so a handler can return its body directly:
 *
 * ```ts
 * return res.json({ csrfToken: csrf.issue(ctx).token });
 * ```
 *
 * Do not also pass the returned `cookie` to `res.header()` in that case or the
 * response will carry two `Set-Cookie` values.
 */
declare function issue(requestCtx: ctx, options?: CsrfIssueOptions): CsrfIssuedToken;
/**
 * Checks a CSRF token on state-changing requests (`POST`, `PUT`, `DELETE`,
 * `PATCH`).
 *
 * By default the `x-csrf-token` header is compared with the `csrf_token`
 * cookie. Pass `{ mode: "double-submit" }` to compare a JSON or form body field
 * instead:
 *
 * ```ts
 * @use(csrf({ mode: "double-submit" })) // reads the `csrf_token` body field
 * @use(csrf())                          // reads the `x-csrf-token` header
 * ```
 *
 * The guard also exposes {@link csrf.issue} (mint a token plus its cookie) and
 * {@link csrf.token} (token-only shortcut).
 *
 * @param options - Header name and token-source mode.
 * @param overrideConfig - Optional error status/message/headers.
 * @returns A guard factory that accepts CSRF options and optional error config.
 */
declare const csrf: ((options?: CsrfOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType) & {
    /**
     * Mints a random CSRF token, serializes its cookie, and writes the cookie
     * through when the response builder supports direct cookie writes.
     *
     * @param requestCtx - Request context used to derive cookie flags.
     * @param options - Cookie name, explicit value, and cookie flags.
     * @returns The token and its serialized `Set-Cookie` value.
     */
    issue: typeof issue;
    /**
     * Mints a CSRF token (see {@link csrf.issue}) and returns just its value.
     *
     * @param requestCtx - Request context used to derive cookie flags.
     * @returns The minted token.
     */
    token(requestCtx: ctx): string;
};

type DenyConfig = ErrorConfig & {
    /** When provided, the guard denies only requests where the predicate returns true; otherwise it continues. */
    when?: (ctx: ctx) => boolean | Promise<boolean>;
};
/**
 * Rejects requests with an HTTP error, optionally only when a predicate matches.
 *
 * Without `when` every request is denied, which is useful for maintenance
 * windows or permanently closing a route. With `when`, non-matching requests
 * continue through the remaining guards and the handler.
 *
 * ```ts
 * @use(deny())                                            // always 403
 * @use(deny({ code: 503, message: "Under maintenance" })) // custom status
 * @use(deny({ when: (ctx) => ctx.req.method === "TRACE" })) // conditional
 * ```
 *
 * @param options - Optional status, message, headers, redirect, and predicate.
 * @returns A guard factory that denies matching requests and continues otherwise.
 */
declare const deny: (options?: DenyConfig | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

interface ErrorGuardOptions {
    /** Log caught errors. Defaults to false. */
    logErrors?: boolean;
    /** Safe message returned for unexpected errors. */
    message?: string;
    /** Custom response handler. */
    onError?: (error: unknown, ctx: ctx) => Response | Promise<Response>;
}
/**
 * Catches errors thrown by downstream guards or handlers and returns a safe
 * 500 response unless a custom handler is provided. Place it before the guards
 * and handlers whose errors it should catch.
 *
 * Header values set through `res.header()` are sanitized when written, and the
 * `res.error`/`res.json` assembler drops any remaining invalid header, so an
 * input such as `?v=a%0d%0aX-Injected:%201` produces a normal safe response
 * instead of a dropped connection. If assembly still fails, this guard answers
 * with a header-free plain-text `500`.
 *
 * @param options - Logging, public message, and custom error response behavior.
 * @returns A guard factory that wraps downstream execution with error handling.
 */
declare const errorHandler: (options?: ErrorGuardOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

type HeaderValidationRules = Record<string, (ctx: ctx, headName: string, value: string) => boolean>;
/**
 * Requires named headers or validates header values with caller-provided rules.
 *
 * @param rules - Header names to require, or a map of names to validators.
 * @returns A guard factory that accepts header rules and optional error config.
 */
declare const header: (options?: string | string[] | HeaderValidationRules | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

type IpOptions = {
    whitelist?: string[];
    blacklist?: string[];
};

/**
 * Allows or blocks requests based on configured client IP allow and deny lists.
 *
 * @param options - IP allowlist and blocklist rules.
 * @returns A guard factory that accepts IP rules and optional error config.
 */
declare const ipFilter: (options?: IpOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

/**
 * TypeScript types for the
 * {@link https://standardschema.dev/ | Standard Schema} and
 * Standard JSON Schema interfaces.
 *
 * They mirror the vendor-neutral contracts consumed by the MCP SDK. Keeping
 * local copies avoids a runtime dependency on the SDK from the schema library.
 */
/** A single property key or named path segment in an issue path. */
type StandardPathSegment = PropertyKey | {
    readonly key: PropertyKey;
};
/** One validation problem in the Standard Schema shape. */
interface StandardIssue {
    /** Human-readable explanation of the failure. */
    readonly message: string;
    /** Location of the failing value inside nested data. */
    readonly path?: ReadonlyArray<StandardPathSegment> | undefined;
}
/** Successful validation result. */
interface StandardSuccessResult<Output> {
    /** Parsed and normalized output value. */
    readonly value: Output;
    readonly issues?: undefined;
}
/** Failed validation result. */
interface StandardFailureResult {
    /** Every problem found while validating the input. */
    readonly issues: ReadonlyArray<StandardIssue>;
}
/** Discriminated union returned by `~standard.validate`. */
type StandardValidateResult<Output> = StandardSuccessResult<Output> | StandardFailureResult;
/** Options passed to `~standard.validate`. */
interface StandardValidateOptions {
    /** Extra options for the producing library; unused by Rossa schemas. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
}
/** JSON Schema dialect requested by a consumer. */
type StandardJSONSchemaTarget = "draft-2020-12" | "draft-07" | "openapi-3.0" | (object & string);
/** Options passed to the `~standard.jsonSchema` converters. */
interface StandardJSONSchemaOptions {
    /** Target dialect. Rossa emits the same subset for every target. */
    readonly target?: StandardJSONSchemaTarget | undefined;
    /** Extra options for the producing library; unused by Rossa schemas. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
}
/** Converters that advertise a schema's wire shape as JSON Schema. */
interface StandardJSONSchemaConverter {
    /** JSON Schema describing accepted input values. */
    readonly input: (options: StandardJSONSchemaOptions) => Record<string, unknown>;
    /** JSON Schema describing produced output values. */
    readonly output: (options: StandardJSONSchemaOptions) => Record<string, unknown>;
}
/** Phantom input/output type pair exposed through `~standard.types`. */
interface StandardTypes<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
}
/** Properties attached to every schema under the `~standard` key. */
interface StandardSchemaProps<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: StandardTypes<Input, Output> | undefined;
    readonly validate: (value: unknown, options?: StandardValidateOptions | undefined) => StandardValidateResult<Output>;
    readonly jsonSchema: StandardJSONSchemaConverter;
}
/** Any value implementing the Standard Schema contract. */
interface StandardSchema<Input = unknown, Output = Input> {
    readonly "~standard": StandardSchemaProps<Input, Output>;
}

/**
 * A single validation problem found while parsing a value.
 *
 * `path` identifies the failing location in nested data (for example
 * `["address", "city"]` or `["tags", 0]`), while `message` is a human-friendly
 * explanation written for API consumers.
 */
type Issue = {
    path: (string | number)[];
    message: string;
};
/** Result of a successful {@link Schema.safeParse} call. */
type SafeParseSuccess<T> = {
    success: true;
    data: T;
};
/** Result of a failed {@link Schema.safeParse} call. */
type SafeParseFailure = {
    success: false;
    error: SchemaError;
};
/** Discriminated union returned by {@link Schema.safeParse}. */
type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseFailure;
/**
 * Error thrown by {@link Schema.parse} when validation fails.
 *
 * Inspect `issues` for structured, path-aware details, or read `message` for a
 * short joined summary.
 */
declare class SchemaError extends Error {
    /** Structured validation problems, in the order they were discovered. */
    readonly issues: Issue[];
    constructor(issues: Issue[]);
}
/**
 * Any schema, regardless of its output type. Useful for guard options and for
 * accepting schemas whose exact output is not important.
 */
type AnySchema = Schema<unknown>;
/** Resolve the output type carried by a schema. */
type InferSchema<S> = S extends Schema<infer Output> ? Output : never;
/** Internal, cloneable flags shared by every schema. */
interface SchemaState {
    optional: boolean;
    nullable: boolean;
    hasDefault: boolean;
    defaultValue: unknown;
}
/**
 * Base class for every schema.
 *
 * It owns the shared modifier flags (`.optional()`, `.nullable()`, `.default()`)
 * and the parse/safeParse entry points. Concrete schemas implement `_clone` and
 * `_validate`. All modifier methods return fresh instances, so a schema value
 * can be safely reused in multiple chains.
 */
declare abstract class Schema<Output> {
    /** Phantom output type used by `z.infer`. */
    readonly _output: Output;
    /**
     * Standard Schema and Standard JSON Schema interface.
     *
     * This is the vendor-neutral contract used by the MCP SDK's `registerTool`
     * and `registerPrompt`. `validate` runs the same pipeline as
     * {@link Schema.safeParse}; `jsonSchema` advertises the wire shape.
     */
    readonly "~standard": StandardSchemaProps<unknown, Output>;
    protected readonly _state: SchemaState;
    constructor(state?: SchemaState);
    /** Create a fresh copy of this schema, including its modifier flags. */
    protected abstract _clone(): this;
    /** Validate a defined, non-null value and return the parsed output. */
    protected abstract _validate(value: unknown, path: (string | number)[], issues: Issue[]): Output | undefined;
    /**
     * Render this schema as JSON Schema.
     *
     * The result uses a subset that is valid for draft-07 and draft-2020-12.
     * Unknown top-level input keys are described with
     * `additionalProperties: false`; the requested target is ignored.
     */
    toJSONSchema(options?: StandardJSONSchemaOptions): Record<string, unknown>;
    /**
     * Implement each concrete schema's JSON Schema mapping.
     *
     * @internal
     */
    protected abstract _jsonSchema(options: StandardJSONSchemaOptions): Record<string, unknown>;
    /**
     * Whether the field must appear in an object's `required` list.
     *
     * Fields with `.optional()` or `.default(...)` are not required.
     *
     * @internal
     */
    _isRequired(): boolean;
    /** Return a copy that also accepts `undefined` (a missing key is allowed). */
    optional(): Schema<Output | undefined>;
    /** Return a copy that also accepts `null`, but still rejects `undefined`. */
    nullable(): Schema<Output | null>;
    /**
     * Return a copy that substitutes `value` when the input is `undefined`.
     * The same default reference is used for every parse.
     */
    default(value: Exclude<Output, undefined>): Schema<Exclude<Output, undefined>>;
    /**
     * Shared handling for `undefined`, `null`, and defaults before a concrete
     * schema runs its own type checks.
     *
     * @internal
     */
    _run(value: unknown, path: (string | number)[], issues: Issue[]): Output | undefined;
    /**
     * Validate a value without throwing.
     *
     * Unknown object keys are stripped from the returned data. On failure the
     * result contains a {@link SchemaError} with every collected issue.
     */
    safeParse(data: unknown): SafeParseResult<Output>;
    /**
     * Validate a value and return the parsed output.
     *
     * @throws {SchemaError} When the input does not satisfy this schema.
     */
    parse(data: unknown): Output;
}

type StringRule = {
    kind: "min";
    value: number;
} | {
    kind: "max";
    value: number;
} | {
    kind: "email";
} | {
    kind: "trim";
};
type NumberRule = {
    kind: "min";
    value: number;
} | {
    kind: "max";
    value: number;
} | {
    kind: "int";
};
interface StringOptions {
    coerce?: boolean;
    rules?: StringRule[];
    state?: SchemaState;
}
interface NumberOptions {
    coerce?: boolean;
    rules?: NumberRule[];
    state?: SchemaState;
}
interface BooleanOptions {
    coerce?: boolean;
    state?: SchemaState;
}
/** Schema for text values, with `.min`, `.max`, and `.email` rules. */
declare class StringSchema extends Schema<string> {
    private readonly _rules;
    private readonly _coerce;
    constructor(options?: StringOptions);
    protected _clone(): this;
    /** Require at least `length` characters. */
    min(length: number): this;
    /** Require at most `length` characters. */
    max(length: number): this;
    /** Require a conventional email address (`local@domain.tld`). */
    email(): this;
    /**
     * Trim leading and trailing whitespace before validation.
     *
     * `.min`, `.max`, and `.email` see the trimmed value, and the parsed output
     * is trimmed.
     */
    trim(): this;
    private _withRule;
    protected _jsonSchema(_options: StandardJSONSchemaOptions): Record<string, unknown>;
    protected _validate(value: unknown, path: (string | number)[], issues: Issue[]): string | undefined;
}
/** Schema for numeric values, with `.min`, `.max`, and `.int` rules. */
declare class NumberSchema extends Schema<number> {
    private readonly _rules;
    private readonly _coerce;
    constructor(options?: NumberOptions);
    protected _clone(): this;
    /** Require a value greater than or equal to `minimum`. */
    min(minimum: number): this;
    /** Require a value less than or equal to `maximum`. */
    max(maximum: number): this;
    /** Require a whole number. */
    int(): this;
    private _withRule;
    protected _jsonSchema(_options: StandardJSONSchemaOptions): Record<string, unknown>;
    protected _validate(value: unknown, path: (string | number)[], issues: Issue[]): number | undefined;
}
/** Schema for boolean values. */
declare class BooleanSchema extends Schema<boolean> {
    private readonly _coerce;
    constructor(options?: BooleanOptions);
    protected _clone(): this;
    protected _jsonSchema(_options: StandardJSONSchemaOptions): Record<string, unknown>;
    protected _validate(value: unknown, path: (string | number)[], issues: Issue[]): boolean | undefined;
}

/** A map of field names to schemas. */
type Shape = Record<string, AnySchema>;
type OptionalShapeKeys<TShape extends Shape> = {
    [K in keyof TShape]: undefined extends InferSchema<TShape[K]> ? K : never;
}[keyof TShape];
/** Output type produced by an object schema, with optional fields preserved. */
type InferShape<TShape extends Shape> = {
    [K in Exclude<keyof TShape, OptionalShapeKeys<TShape>>]: InferSchema<TShape[K]>;
} & {
    [K in OptionalShapeKeys<TShape>]?: Exclude<InferSchema<TShape[K]>, undefined>;
};
type ArrayRule = {
    kind: "min";
    value: number;
} | {
    kind: "max";
    value: number;
};
interface ArrayOptions {
    rules?: ArrayRule[];
    state?: SchemaState;
}
/** Schema for arrays whose items share a single item schema. */
declare class ArraySchema<Item extends AnySchema> extends Schema<InferSchema<Item>[]> {
    private readonly _item;
    private readonly _rules;
    constructor(item: Item, options?: ArrayOptions);
    protected _clone(): this;
    /** Require at least `length` items. */
    min(length: number): this;
    /** Require at most `length` items. */
    max(length: number): this;
    private _withRule;
    protected _jsonSchema(options: StandardJSONSchemaOptions): Record<string, unknown>;
    protected _validate(value: unknown, path: (string | number)[], issues: Issue[]): InferSchema<Item>[] | undefined;
}
interface ObjectOptions {
    state?: SchemaState;
}
/**
 * Schema for objects with a fixed shape.
 *
 * Unknown input keys are stripped from the parsed output (zod `.strip()`
 * behavior).
 */
declare class ObjectSchema<TShape extends Shape> extends Schema<InferShape<TShape>> {
    /** Field schemas keyed by output property name. */
    readonly shape: TShape;
    constructor(shape: TShape, options?: ObjectOptions);
    protected _clone(): this;
    protected _jsonSchema(options: StandardJSONSchemaOptions): Record<string, unknown>;
    protected _validate(value: unknown, path: (string | number)[], issues: Issue[]): InferShape<TShape> | undefined;
}

/** Create a text schema. */
declare const string: () => StringSchema;
/** Create a numeric schema. */
declare const number: () => NumberSchema;
/** Create a boolean schema. */
declare const boolean: () => BooleanSchema;
/** Create an array schema for the given item schema. */
declare const array: <Item extends AnySchema>(item: Item) => ArraySchema<Item>;
/** Create an object schema with a fixed shape. */
declare const object: <TShape extends Shape>(shape: TShape) => ObjectSchema<TShape>;
/**
 * Coercing variants that convert raw query/form strings before validation.
 * Non-string inputs pass through to the underlying type checks.
 */
declare const coerce: {
    /** Create a text schema that stringifies numbers and booleans. */
    string: () => StringSchema;
    /** Create a numeric schema that converts numeric strings with `Number()`. */
    number: () => NumberSchema;
    /**
     * Create a boolean schema that accepts `"true"`/`"1"` and
     * `"false"`/`"0"` case-insensitively.
     */
    boolean: () => BooleanSchema;
};
/**
 * Resolve the output type of a schema.
 *
 * ```ts
 * const User = z.object({ name: z.string() });
 * type User = z.infer<typeof User>; // { name: string }
 * ```
 */
type Infer<S extends AnySchema> = InferSchema<S>;

declare const z_d_array: typeof array;
declare const z_d_boolean: typeof boolean;
declare const z_d_coerce: typeof coerce;
declare const z_d_number: typeof number;
declare const z_d_object: typeof object;
declare const z_d_string: typeof string;
declare namespace z_d {
  export { z_d_array as array, z_d_boolean as boolean, z_d_coerce as coerce, z_d_number as number, z_d_object as object, z_d_string as string };
  export type { Infer as infer };
}

declare const DEFAULT_MAX_SIZE: number;
/**
 * Parses and validates JSON request bodies for POST, PUT, and PATCH requests.
 *
 * The validated value is stored on `ctx.body` (the same field populated by
 * `keys([...])`) and, for backwards compatibility, on the request as `_json`.
 * Handlers should read `ctx.body`; `ctx.req._json` remains supported.
 *
 * @param schema - Schema used to validate the parsed JSON object.
 * @returns A guard factory that accepts a schema and optional error config.
 */
declare const json: (options?: AnySchema | undefined, overrideConfig?: BaseConfig) => GuardReturnType;
interface RequireKeysOptions {
    keys: string[];
}
/**
 * Requires the JSON request body to contain each listed key and stores the
 * parsed body in `ctx.body`.
 *
 * @param keys - Required top-level body keys.
 * @returns A guard factory that accepts required keys and optional error config.
 */
declare const keys: (options?: string[] | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

type JwtPayload<T> = T & {
    iat: number;
    exp: number;
    /**
     * Unique token identifier assigned on every signature.
     *
     * Optional only so tokens issued before this claim existed remain readable.
     */
    jti?: string;
};
/** Result of inspecting a token without throwing. */
type JwtInspection<T> = {
    ok: true;
    payload: JwtPayload<T>;
} | {
    ok: false;
    reason: "invalid" | "expired";
};
declare class JwtEngine<T extends Record<string, any> = Record<string, any>> {
    private readonly secretKey;
    constructor(secret: string);
    /**
     * Generates a signed JWT Access Token.
     *
     * A fresh `jti` is always assigned, so signing the same claims twice within
     * the same clock second still produces two distinct tokens. Any caller
     * supplied `jti`, `iat`, or `exp` is replaced rather than reused.
     */
    sign(payload: T, expiresInMinutes?: number): string;
    /**
     * Generates a signed token with a lifetime expressed in seconds.
     *
     * Use this for sub-minute lifetimes (tests, short-lived one-off tokens)
     * without changing the service's minute-based default.
     */
    signSeconds(payload: T, expiresInSeconds: number): string;
    /** Shared token builder; `lifetimeSeconds` is added to the current `iat`. */
    private build;
    /**
     * Verifies the JWT mathematically and reports why an unusable token failed.
     *
     * Signature and shape failures are `"invalid"`; a valid signature whose
     * `exp` has passed is `"expired"`. Never throws.
     */
    inspect(token: string): JwtInspection<T>;
    /**
     * Verifies the JWT mathematically. Returns payload if valid, or null if expired/tampered.
     */
    verify(token: string): JwtPayload<T> | null;
    /**
     * Issues a long-lived refresh token.
     *
     * Each call produces a distinct token because `sign` assigns a fresh `jti`,
     * which is what makes rotation + single-use stores replay-safe.
     */
    issue(data: T, daysValid?: number): string;
}

/**
 * Why a refresh token was rejected.
 *
 * - `invalid` — missing, malformed, or forged token (bad signature/shape).
 * - `expired` — validly signed token whose `exp` has passed.
 * - `reused` — valid, unexpired token that the store no longer considers
 *   available (already consumed or otherwise claimed).
 */
type RefreshRejectionReason = "invalid" | "expired" | "reused";
/** Result of a refresh-token consumption attempt. */
type RefreshConsumeResult<T extends Record<string, any> = {}> = {
    ok: true;
    claims: JwtPayload<T>;
} | {
    ok: false;
    reason: RefreshRejectionReason;
};
/**
 * Persistence contract for refresh tokens.
 *
 * Implement this interface with any database, key-value store, or external
 * persistence service. `consume` must atomically *claim* a token and return
 * `true` only for the caller that claimed it, preventing concurrent reuse.
 *
 * Claim-once does not require deleting the row: a store may keep the row and
 * stamp `consumed_at`, returning `false` on every later attempt. Keeping the
 * audit trail is therefore allowed; only the boolean contract matters.
 */
interface JwtRefreshTokenStore {
    /** Initialize the backing store or its schema when needed. */
    initialize?(): Promise<void>;
    /** Persist a refresh token until its Unix expiration time in milliseconds. */
    save(token: string, expiresAt: number): Promise<void>;
    /**
     * Atomically claim a stored refresh token and report whether this caller
     * won. May delete the row or mark it consumed; later calls must return
     * `false`.
     */
    consume(token: string): Promise<boolean>;
    /**
     * Optional maintenance hook: remove rows that expired before `before`
     * (Unix milliseconds). Implementations without it keep working; callers
     * should treat a missing hook as a no-op.
     *
     * @returns The number of removed rows, when the store reports it.
     */
    deleteExpired?(before: number): Promise<number | void>;
}
interface JWTConfig {
    /** Refresh token lifetime in days. Defaults to 7. */
    refreshValidity?: number;
    /** Access token lifetime in minutes. Defaults to 15. */
    tokenValidity?: number;
}
/**
 * Signs access tokens and manages one-time refresh tokens through an injected
 * persistence adapter.
 *
 * @typeParam T - Shape of the claims carried by the access and refresh tokens.
 */
declare class JWTAuthService<T extends Record<string, any> = {}> {
    private readonly refreshTokens;
    readonly config: Required<JWTConfig>;
    private readonly engine;
    constructor(refreshTokens: JwtRefreshTokenStore, secret: string, config?: JWTConfig);
    /** Initialize the configured persistence adapter, if it needs initialization. */
    init(): Promise<void>;
    /**
     * Sign an access token.
     *
     * @param payload - Claims to embed.
     * @param lifetimeSeconds - Optional per-call lifetime in seconds. When
     * omitted, the service's minute-based `tokenValidity` is used.
     */
    sign(payload: T, lifetimeSeconds?: number): string;
    /** Verify an access token and return its claims, or `null` if invalid. */
    verify(token: string): JwtPayload<T> | null;
    /**
     * Atomically consume a valid, stored refresh token.
     *
     * @returns The token claims when consumption succeeds; otherwise `null`.
     */
    consume(token: string): Promise<JwtPayload<T> | null>;
    /**
     * Atomically consume a refresh token and report why it was rejected.
     *
     * Expired, malformed, and already-claimed tokens are distinguished without
     * changing {@link JWTAuthService.consume}'s existing claims/`null` result.
     */
    consumeWithReason(token: string): Promise<RefreshConsumeResult<T>>;
    /**
     * Remove refresh-token rows that expired before `before` when the store
     * implements the optional cleanup hook. Stores without it are a no-op.
     *
     * @param before - Unix milliseconds cutoff (defaults to now).
     */
    deleteExpired(before?: number): Promise<number | void>;
    /** Issue a refresh token, persist it, and return it with a new access token. */
    issue(payload: T): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
}

/**
 * Verifies a Bearer access token and stores its decoded claims in
 * `ctx.jwtData`.
 *
 * Every rejection carries `WWW-Authenticate: Bearer` and the guard's 401
 * body. When composing with {@link jwtRefresh}, mount this guard first so the
 * refresh guard runs with an already-validated access token:
 *
 * ```ts
 * @use(jwtAuth(service), jwtRefresh(service))
 * ```
 *
 * @param service - JWT service used to verify the access token.
 * @returns A guard factory that accepts a JWT service and optional error config.
 */
declare const jwtAuth: (options?: JWTAuthService<any> | undefined, overrideConfig?: BaseConfig) => GuardReturnType;
/**
 * Consumes an `x-refresh-token`, issues a replacement token pair, and stores
 * the refresh claims in `ctx.data.jwtRefreshData` and the new tokens in
 * `ctx.data.jwtTokens`.
 *
 * `ctx.jwtData` is only populated with the refresh claims when the access
 * guard has not already set it; access claims therefore win on combined
 * routes. When an `Authorization` header is present, the access token is
 * verified before the refresh token is consumed, so a refresh-first route
 * does not burn the token when authentication ultimately fails.
 *
 * Compose after {@link jwtAuth} where possible, or use {@link jwtRotate} for
 * a single rotation endpoint:
 *
 * ```ts
 * @use(jwtAuth(service), jwtRefresh(service))
 * ```
 *
 * @param service - JWT service used to consume and issue tokens.
 * @returns A guard factory that accepts a JWT service and optional error config.
 */
declare const jwtRefresh: (options?: JWTAuthService<any> | undefined, overrideConfig?: BaseConfig) => GuardReturnType;
/**
 * Rotates a session in one guard: verifies the access token when present and
 * then consumes the refresh token.
 *
 * - Access token present and invalid → 401 without consuming the refresh
 *   token, so a failed authentication never burns it.
 * - Access token present and valid → its claims stay in `ctx.jwtData`.
 * - Access token absent → refresh claims become `ctx.jwtData` (refresh-only
 *   rotation).
 *
 * The refresh claims are always also exposed as `ctx.data.jwtRefreshData` and
 * the replacement pair as `ctx.data.jwtTokens`. Every 401 carries
 * `WWW-Authenticate: Bearer`; refresh failures include `error_code`.
 *
 * ```ts
 * @use(jwtRotate(service))
 * ```
 *
 * @param service - JWT service used to verify, consume, and issue tokens.
 * @returns A guard factory that accepts a JWT service and optional error config.
 */
declare const jwtRotate: (options?: JWTAuthService<any> | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

/**
 * Logs the request method, path, timestamp, and optional label before continuing.
 *
 * @param label - Optional text included in the log entry.
 * @returns A guard factory that accepts a label and optional error config.
 */
declare const logger: (options?: string | void | undefined, overrideConfig?: BaseConfig) => GuardReturnType;
type logFN = {
    ctx: ctx;
    res: Response;
    timestamp: string;
    method: string;
    url: string;
};
/**
 * Runs a formatter with request metadata and the downstream response, then logs
 * its returned value when truthy.
 *
 * @param formatter - Function that formats the request and response details.
 * @returns A guard factory that accepts a formatter and optional error config.
 */
declare const loggerFN: (options?: ((ff: logFN) => any) | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

interface MultipartOptions {
    /**
     * Maximum accepted request-body size, in bytes.
     *
     * The declared `Content-Length` is checked first, then the bytes actually
     * received, so an understated header cannot bypass the cap. Over-limit
     * payloads are rejected with `413` before the form is parsed and never reach
     * the route. The `413` status and message match `json()`'s limit response.
     *
     * @default 1048576 (1 MiB, same default as `json()`)
     */
    maxSize?: number;
}
/**
 * Parses a multipart request and stores its fields and uploaded files in
 * `ctx.form`.
 *
 * Uploaded `File` objects keep the MIME type declared in their part headers,
 * including when Bun's parser reports `File.type` as empty. Field names,
 * file names, sizes, and bytes are unchanged.
 *
 * Bodies are capped at 1 MiB like `json()`; pass `multipart({ maxSize })` to
 * change the limit. Over-limit payloads answer `413` before parsing.
 *
 * @param options - Optional `maxSize` body cap.
 * @returns A guard factory that parses multipart form data before continuing.
 */
declare const multipart: (options?: MultipartOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

/** Options accepted by {@link validateQuery}. */
interface QueryValidationOptions {
    /** Schema used to validate and coerce query parameters. */
    schema: AnySchema;
}
/** Options accepted by {@link validateForm}. */
interface FormValidationOptions {
    /** Schema used to validate and coerce form fields. */
    schema: AnySchema;
}
/**
 * Validates and coerces URL query parameters against a schema, then stores the
 * result in `ctx.query`.
 *
 * @param schema - Schema used to validate and coerce query values.
 * @returns A guard factory that accepts the schema and optional error config.
 */
declare const validateQuery: (options?: AnySchema | undefined, overrideConfig?: BaseConfig) => GuardReturnType;
/**
 * Validates multipart or URL-encoded form fields against a schema and stores
 * the processed result in `ctx.form`.
 *
 * @param schema - Schema used to validate and coerce form values.
 * @returns A guard factory that accepts the schema and optional error config.
 */
declare const validateForm: (options?: AnySchema | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

interface RateLimitOptions {
    /** Maximum number of connections/requests allowed within the window. @default 100 */
    max?: number;
    /** Window duration in milliseconds. @default 60000 (1 minute) */
    windowMs?: number;
    /** Whether to attach X-RateLimit-* headers to responses. @default true */
    expose?: boolean;
}
/**
 * Limits requests by client IP, HTTP method, and URL path.
 *
 * @param options - Request limit, time window, and response-header settings.
 * @returns A guard factory that accepts rate-limit settings and optional error config.
 */
declare const rateLimit: (options?: RateLimitOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

interface SanitizeOptions {
    /** Custom string sanitizer. Defaults to escaping HTML-sensitive characters. */
    sanitizeString?: (value: string) => string;
    /** Whether to sanitize `ctx.query`. @default true */
    query?: boolean;
    /** Whether to sanitize `ctx.form`. @default true */
    form?: boolean;
    /** Whether to sanitize parsed JSON in `ctx.body` and `ctx.req._json`. @default true */
    body?: boolean;
}
/**
 * Escapes or custom-sanitizes string values in parsed request data before
 * handlers consume them. Continue to encode output for its final HTML context.
 *
 * @param options - Selects request data and the string sanitizer to apply.
 * @returns A guard factory that sanitizes selected context data.
 */
declare const sanitize: (options?: SanitizeOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

interface SecurityHeadersOptions {
    contentSecurityPolicy?: string | false;
    crossOriginEmbedderPolicy?: string | false;
    crossOriginOpenerPolicy?: string | false;
    crossOriginResourcePolicy?: string | false;
    hsts?: string | false;
    permissionsPolicy?: string | false;
    referrerPolicy?: string | false;
    xContentTypeOptions?: string | false;
    xFrameOptions?: string | false;
}
/**
 * Adds common security headers to downstream responses. CSP and HSTS are opt-in
 * because their correct values depend on the application and deployment.
 *
 * @param options - Header values to apply or disable.
 * @returns A guard factory that applies security headers to each response.
 */
declare const security: (options?: SecurityHeadersOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

declare class Signator {
    salt: string;
    private readonly key;
    constructor(salt: string);
    /**
     * Generates an HMAC SHA-256 signature, encoded cleanly for URLs.
     */
    getSignature(val: string): string;
    /**
     * Attaches the signature to the value using the standard "." separator.
     * Format: payload.signature
     */
    sign(val: string): string;
    /**
     * Verifies a signed string.
     * Returns the original value if valid, or null if tampered/invalid.
     */
    unsign(signedVal: string): string | null;
    /**
     * Cryptographically secure comparison to prevent Timing Attacks.
     */
    private verifySignature;
}

declare class SidGenerator {
    protected signer: Signator;
    constructor(salt: string);
    /**
     * Generates a URL-safe, cryptographically secure, signed session ID.
     */
    generate(len?: number): string;
}

interface AuthConfig {
    COOKIE_NAME?: string;
    COOKIE_LIFETIME?: number;
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
/**
 * Abstract session service: signing, cookie serialization, expiration, and
 * identifier rotation. Subclasses implement the storage hooks.
 *
 * @typeParam TData - Shape of the data stored on the session. It types the
 * resolved session (see {@link SessionInstance}) without casts.
 */
declare abstract class SessionAuthInterface<TData extends Record<string, any> = Record<string, any>> extends SidGenerator {
    config: Required<AuthConfig>;
    constructor(config: AuthConfig, salt?: string);
    init(): Promise<void>;
    /**
     * Verifies the cryptographic signature and opens the session.
     */
    openSession(sid?: string, readonly?: boolean): Promise<SessionInstance<TData>>;
    /** To be implemented by child class: Retrieve from DB */
    fetchSession(sid: string, readonly?: boolean): Promise<SessionInstance<TData>>;
    abstract fetchData(sid: string, readonly?: boolean): Promise<any | undefined>;
    /** To be implemented by child class: Save to DB */
    abstract saveSession(session: ServerSide, headers: Headers): Promise<void>;
    /** To be implemented by child class: Save to DB */
    abstract deleteSession(session: ServerSide, headers: Headers): Promise<void>;
    /** Instantiates a fresh, writable session */
    new({ sid, isFound, readonly, }: newSession): SessionInstance<TData>;
    /** Instantiates a read-only session */
    get readonly(): SessionInstance<TData>;
    /**
     * Attaches the rotation hook and exposes the proxy that merges the
     * framework API with the session data.
     */
    protected materialize(session: ServerSide<TData>): SessionInstance<TData>;
    /**
     * Mints a new signed `sid` for the session and deletes the previous row.
     *
     * The guard persists the new row (and sends its cookie) after the handler
     * returns because the session is marked modified. Used by
     * {@link ServerSide.rotate}; call that instead of this method directly.
     *
     * @param session - Session to re-key. Must not be readonly.
     */
    rotateSession(session: ServerSide<TData>): Promise<void>;
    /**
     * Deletes a stored row without emitting a cookie for the new session.
     * A store that fails after deleting the row (for example while serializing
     * the removal cookie) is still treated as successful.
     */
    private removeStoredSession;
    /**
     * Calculates the exact Date object when this session expires.
     *
     * Fractional-day lifetimes are preserved: computation is performed in
     * milliseconds instead of truncating through `Date#setDate`.
     */
    get getSessionExpirationDate(): Date;
    /**
     * Calculates the exact Date object when the session cookie expires.
     *
     * Fractional-day lifetimes are preserved to the millisecond.
     */
    get getCookieExpirationDate(): Date;
    /**
     * Verifies if the session is still active and has not expired.
     * @returns true if valid, false if expired.
     */
    isNotExpired(_date: Date): boolean;
    /**
     * Builds the raw standard HTTP Set-Cookie string.
     */
    buildCookieString(session: ServerSide, expirationOverride?: Date | number, sameSiteOverride?: AuthConfig["COOKIE_SAMESITE"]): string;
    setCookie(session: ServerSide, headers: Headers): void;
    removeCookie(session: ServerSide, headers: Headers): void;
    /**
     * Extracts the Cookie directly from the Web API Request instance.
     */
    loadHeader(req: Request, readonly?: boolean): Promise<[string | undefined, SessionInstance<TData>]>;
}

/**
 * Object form accepted by {@link session}. A readonly mount loads the session
 * without letting handlers mutate or persist it.
 */
interface SessionMount<TData extends Record<string, any> = Record<string, any>> {
    /** Session service used to load, save, and delete sessions. */
    auth: SessionAuthInterface<TData>;
    /** Discard handler writes and skip persistence. Defaults to `false`. */
    readonly?: boolean;
}
/**
 * Legacy name for {@link SessionMount}; kept so existing imports keep
 * compiling.
 */
type SessionConfig = SessionMount;
/** A session guard with its data shape attached for editor hints. */
type SessionGuard<TData extends Record<string, any>> = GuardReturnType & {
    /** Phantom marker: the session data shape mounted by this guard. */
    readonly __sessionData?: TData;
};
/**
 * Loads the request session into `ctx.session` and persists session changes
 * after downstream guards and handlers complete.
 *
 * Accepts a session service directly (the original form) or a mount object
 * with a readonly switch:
 *
 * ```ts
 * @use(session(sessions))                     // writable
 * @use(session({ auth: sessions, readonly: true })) // discard writes
 * @use(session<AccountSession>(sessions))     // typed ctx.session data
 * ```
 *
 * Type the handler context with {@link SessionContext} (or read the session
 * from the generic mount) to avoid casting `ctx.session` data properties.
 *
 * @param mount - Session service, or `{ auth, readonly? }`.
 * @param overrideConfig - Optional error configuration for persistence errors.
 * @returns A guard that loads, exposes, and persists the request session.
 */
declare function session<TData extends Record<string, any> = Record<string, any>>(mount: SessionAuthInterface<any> | SessionMount<any>, overrideConfig?: BaseConfig): SessionGuard<TData>;
/**
 * A `ctx` whose `session` is typed with the mounted session data.
 *
 * ```ts
 * import type { SessionContext } from "rossa";
 *
 * async post(ctx: SessionContext<AccountSession>) {
 *   ctx.session?.email; // string — no cast
 * }
 * ```
 */
type SessionContext<TData extends Record<string, any> = Record<string, any>> = ctx<Record<string, string>, SessionInstance<TData>>;
/** Optional extra check applied to a session that `session()` already resolved. */
type SessionValidator = (session: ServerSide) => boolean | Promise<boolean>;
/**
 * Rejects requests that do not carry a valid, stored session.
 *
 * A session counts as authenticated only when the cookie signature is valid,
 * the row still exists in the store, it has not expired, and it is not a
 * freshly created anonymous session. Compose this guard after
 * `session(service)` — it reads `ctx.session` and never loads the cookie
 * itself:
 *
 * ```ts
 * @use(session(service), requireSession())
 * ```
 *
 * Pass a validator to add an application-level check, for example an identity
 * field written during login. Session data keys are not part of the
 * `ServerSide` type, so cast to your session shape:
 *
 * ```ts
 * @use(session(service), requireSession((s) => typeof (s as AccountSession).userId === "number"))
 * ```
 *
 * @param validator - Optional additional check for the resolved session.
 * @returns A guard factory that returns 401 and continues otherwise.
 */
declare const requireSession: (options?: SessionValidator | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

/** Configuration for a {@link staticFiles} mount. */
interface StaticFilesOptions {
    /**
     * Restricts this mount to request paths under the given prefix. The decoded
     * pathname is compared at a path-segment boundary, so `/assets` matches
     * `/assets` and `/assets/app.js` but not `/assetsfoo.png`. Requests outside
     * the prefix fall through to the remaining guards and routes, which keeps
     * authentication and route handling reachable. Omit it to intercept every
     * file-like path, as a global static mount does.
     */
    prefix?: string;
    /**
     * Directory this mount serves from. Relative paths resolve against
     * `process.cwd()`; absolute paths are used as-is. When set, the mount uses a
     * dedicated static file server instead of the app-wide `clientPath` server.
     * With a `prefix`, the prefix is stripped before the lookup, so
     * `/files/logo.png` maps to `<root>/logo.png`. Without a prefix the full
     * request path is used.
     */
    root?: string;
    /**
     * Additional file extensions recognized by this mount, with or without a
     * leading dot. They extend the built-in extension list but do not replace
     * the app-wide `fileExtensions` configuration.
     */
    extensions?: string[];
    /**
     * Development flag: disables the ≤ 50 KB in-memory cache for this mount so
     * edited assets are always fresh. Every request re-reads the file, so the
     * body and its content-hash `ETag` always reflect the bytes on disk. Files
     * above the 50 KB threshold already skip the cache, so the flag has no
     * effect on them. Requires `root`: without it the mount uses the app-wide
     * server, whose cache is shared by every mount and cannot be opted out of
     * here.
     */
    dev?: boolean;
}
/**
 * Serves requests for file-like paths through a static file server.
 * Only GET and HEAD requests are intercepted; HEAD responses keep the file
 * headers but drop the body.
 *
 * Without options it behaves like a global mount: every recognized file-like
 * path is served from the app-wide `clientPath` server before route guards run.
 * Pass `prefix` and/or `root` to scope a mount, for example
 * `staticFiles({ prefix: "/files", root: "./private-files" })` registered
 * behind an authentication guard.
 *
 * @param options - Optional prefix, root, extension, and development configuration.
 * @returns A guard factory that serves static assets before route handling.
 */
declare const staticFiles: (options?: StaticFilesOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

/**
 * Stops waiting for downstream work after the configured number of milliseconds.
 *
 * @param ms - Maximum time to wait for downstream guards and handlers.
 * @returns A guard factory that accepts a timeout and optional error config.
 */
declare const timeout: (options?: number | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

/** Function signature for a guard that receives request context and continues the pipeline. */
type GlobalGuard = (ctx: ctx, next: () => Promise<Response>) => Promise<Response>;

interface UrlValidationOptions {
    maxUrlLength?: number;
    maxQueryLength?: number;
    allowedKeys?: string[];
    disallowedKeys?: string[];
    noDuplicates?: boolean;
    /** Block path traversal attempts in the pathname and decoded query string (`../` or `%2e%2e`). */
    sanitizePaths?: boolean;
    patterns?: Record<string, RegExp>;
}
/**
 * Validates URL and query limits, query keys, duplicate keys, and path safety.
 *
 * Traversal markers are rejected in both the decoded pathname and the decoded
 * query string unless `sanitizePaths` is `false`, so `/search?x=../etc`
 * answers 400 under the default configuration.
 *
 * @param options - URL size, query, and path validation rules.
 * @returns A guard factory that accepts validation rules and optional error config.
 */
declare const validateUrl: (options?: number | void | UrlValidationOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

interface UrlencodedOptions {
    /**
     * Reject malformed percent-encoding (`%ZZ`, a bare `%`) and NUL bytes as a
     * normal guard rejection instead of passing them through verbatim.
     *
     * The rejection uses the guard's error config, so the message and status are
     * configurable: `urlencoded({ strict: true }, { code: 422, message: "..." })`.
     *
     * @default false
     */
    strict?: boolean;
    /**
     * Maximum accepted request-body size, in bytes.
     *
     * The declared `Content-Length` is checked first, then the bytes actually
     * received, so an understated header cannot bypass the cap. Over-limit
     * payloads are rejected with `413` before the form is parsed and never reach
     * the route. The `413` status and message match `json()`'s limit response.
     *
     * @default 1048576 (1 MiB, same default as `json()`)
     */
    maxSize?: number;
}
/**
 * Parses an URL-encoded form request and stores its fields in `ctx.form`.
 *
 * By default malformed percent-encoding and NUL bytes are accepted verbatim
 * (the lenient behavior of `Request.formData()`). Pass
 * `urlencoded({ strict: true })` to reject them with the guard's error config
 * (400 by default).
 *
 * Bodies are capped at 1 MiB like `json()`; pass `urlencoded({ maxSize })` to
 * change the limit. Over-limit payloads answer `413` before parsing.
 *
 * @param options - Optional `strict` parsing mode and `maxSize` body cap.
 * @param overrideConfig - Per-call error status/message/headers.
 * @returns A guard factory that parses URL-encoded form data before continuing.
 */
declare const urlencoded: (options?: UrlencodedOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

type ScopeDecorator<V> = (value: undefined, context: ClassFieldDecoratorContext<any, V>) => (this: any) => V;
type ScopeProxy<T> = {
    readonly [K in keyof T]: ScopeDecorator<T[K]>;
};
type FieldScopeSet<Config extends Record<string, Record<string, any>>> = {
    use<Name extends keyof Config & string>(name: Name): ScopeProxy<Config[Name]>;
};
declare class _FieldScope {
    private static registry;
    static register<Config extends Record<string, Record<string, any>>>(data: Config): FieldScopeSet<Config>;
    static use<T extends Record<string, any>>(scopeName: string): ScopeProxy<T>;
}
/**
 * Describes the static interface of the Field class
 */
interface FieldScopeStatic {
    register<Config extends Record<string, Record<string, any>>>(data: Config): FieldScopeSet<Config>;
    use<T extends Record<string, any>>(name: string): ScopeProxy<T>;
}
type Field = _FieldScope;
declare const Field: FieldScopeStatic;

type ScopeSet<Config extends Record<string, Record<string, any>>> = {
    use<Name extends keyof Config & string>(name: Name): Config[Name];
};
/** Named, shared values for use in functions, classes, or application setup. */
declare class _Scope {
    private static registry;
    static register<Config extends Record<string, Record<string, any>>>(data: Config): ScopeSet<Config>;
    static use<T extends Record<string, any>>(name: string): T;
}
/** Describes the static interface of the Scope class. */
interface ScopeStatic {
    register<Config extends Record<string, Record<string, any>>>(data: Config): ScopeSet<Config>;
    use<T extends Record<string, any>>(name: string): T;
}
type Scope = _Scope;
declare const Scope: ScopeStatic;

export { ArraySchema, BooleanSchema, Column, DEFAULT_MAX_SIZE, DEFAULT_TOPIC_HISTORY_LIMIT, DatabaseError, DbInspector, DbRepository, DbSchema, Field, ForeignKeyError, JWTAuthService, JwtEngine, McpController, Methods, NumberSchema, ObjectSchema, req as Req, res as Res, Rossa, RouterManager, Schema, SchemaError, Scope, ServerSide, SessionAuthInterface, StringSchema, UniqueConstraintError, WSSMAN, Websocket, WssManager, apiKey, auth, authBearer, authorize, configureSqlite, contentType, cookies, cors, createGuard, createSqliteDatabase, csrf, ctx, deny, errorHandler, getDialect, header, ipFilter, isLocalRedirectTarget, json, jwtAuth, jwtRefresh, jwtRotate, keys, logger, loggerFN, mariadbDialect, mcp, multipart, mysqlDialect, postgresDialect, rateLimit, requireSession, route, sanitize, security, sendError, session, smartCache, sqliteDialect, sqliteIntegrityCheck, sqliteWalCheckpoint, staticFiles, subManager, t, timeout, urlencoded, use, validateForm, validateQuery, validateUrl, wss, z_d as z };
export type { AnySchema, AuthConfig, AutoBodyOptions, AutoBodyResult, BaseConfig, CacheOptions, ColumnType, ContentEncodingType, ContentTypeRules, CookieOptions, CorsOptions, CsrfIssueOptions, CsrfIssuedToken, CsrfOptions, DbDialectAdapter, DbDialectName, DbSchemaIndex, DbSchemaOptions, DenyConfig, ErrorConfig, ErrorGuardOptions, FindManyOptions, FormValidationOptions, GlobalGuard, GuardConfig, GuardFactoryHandler, GuardReturnType, HeaderValidationRules, HttpRouteConfig, HttpRouteMatch, InferSchema, InferShape, Issue, JWTConfig, JwtInspection, JwtPayload, JwtRefreshTokenStore, McpOptions, McpServerFactory, MultipartOptions, QueryValidationOptions, RateLimitOptions, RefreshConsumeResult, RefreshRejectionReason, RequireKeysOptions, RossaOptions, RossaWebSocketOptions, SafeParseFailure, SafeParseResult, SafeParseSuccess, SanitizeOptions, SchemaState, SecurityHeadersOptions, SessionConfig, SessionContext, SessionGuard, SessionInstance, SessionMount, SessionValidator, Shape, SqliteConfigOptions, SqliteConnection, SqliteConnectionInfo, SqliteJournalMode, SqliteSynchronous, SqliteTempStore, StandardIssue, StandardJSONSchemaConverter, StandardJSONSchemaOptions, StandardJSONSchemaTarget, StandardPathSegment, StandardSchema, StandardSchemaProps, StandardTypes, StandardValidateOptions, StandardValidateResult, StaticFilesOptions, TableStats, TopicBroadcastOptions, TopicHistoryStore, TopicMember, TopicPresenceEvent, TopicPresenceFrame, TopicPublishResult, TopicPublishStatus, UrlValidationOptions, UrlencodedOptions, Where, WssBaseController, WssConfig, WssHistoryConfig, WssMessageRateLimit, WssPresenceOptions, WssRouteConfig, WssSocketData, dev, methodsKeys, serverOptions, wssMessage };
