import { Server, SocketAddress, BunFile, ServerWebSocket, WebSocketHandler, SQL } from 'bun';
import { McpServer, McpRequestContext } from '@modelcontextprotocol/server';
export { McpRequestContext, McpServer } from '@modelcontextprotocol/server';

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

declare class ServerSide<TData extends Record<string, any> = Record<string, any>> {
    sid: string;
    data: TData;
    isNew: boolean;
    isModified: boolean;
    isReadOnly: boolean;
    isFound: boolean;
    length: number;
    constructor(sid?: string, initialData?: Partial<TData>, readOnly?: boolean, isNew?: boolean, isFound?: boolean);
    /**
     * Generates the dynamic Proxy trapped instance.
     * We use `this & TData` so TypeScript knows this object contains both
     * the class methods AND the dynamic user data.
     */
    get session(): any;
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
    code?: number | undefined;
    message?: string | undefined;
    redirect?: string | undefined;
    headers?: Record<string, string> | undefined;
    error?: (ctx: ctx) => Response;
    maxSize?: number | undefined;
};
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

declare class StaticFileServer {
    private readonly absoluteClientPath;
    private readonly additionalExtensions;
    private readonly SMALL_FILE_THRESHOLD;
    private readonly CACHE_TTL;
    constructor(resolvedAssetRootPath: string, additionalExtensions?: string[]);
    isFile(path: string): boolean;
    serve(req: req, res: res): Promise<Response>;
}

type HeaderObject = Record<string, string>;
interface RespoOptions {
    /** Compression encoding to apply to generated response bodies. */
    encoding?: ContentEncodingType;
}
interface FileMeta {
    /** Byte length of a raw `Uint8Array` file. */
    size: number;
    /** MIME type of a raw `Uint8Array` file. */
    type: string;
}
/** Builds HTTP responses while retaining status, headers, and encoding settings. */
declare class res {
    readonly req: req;
    private readonly staticServer;
    private readonly server?;
    private _code;
    private _headers;
    private _encoding?;
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
     * @param input - A header builder or a map of header names to values.
     * @returns This response builder for chaining.
     */
    header(input: Heder | HeaderObject): this;
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
     * Creates an empty redirect response with a `Location` header.
     *
     * @param url - Destination URL placed in the `Location` header.
     * @param status - Redirect status code; defaults to `302`.
     */
    redirect(url: string, status?: number): Response;
    /**
     * use fileserver to serve the file securely.
     */
    /** Serves the current request through the configured secure static file server. */
    fileServer(): Promise<Response>;
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
    file(file: BunFile | Uint8Array, meta?: FileMeta, extraHeaders?: Heder | HeaderObject): Promise<Response>;
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
     * request timeout for the current request. If this response builder was
     * created without a Bun server, its helpers return a `500` response.
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
interface TopicPublishResult {
    topic: string;
    status: TopicPublishStatus;
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
    /** Publishes to unique topics and returns Bun's outcome for each topic. */
    broadcast(topics: string[], data: any): TopicPublishResult[];
}
declare class WssManager {
    private connections;
    private topicConfigs;
    private topicRegistry;
    private memberTopics;
    private roomAdmins;
    private defaultTopicConfig;
    /** 1. Lifecycle: Register/Unregister Connections */
    register(ws: ServerWebSocket<any>, nickname?: string): string;
    getMemberDetails(topic: string): {
        id: string;
        userId: any;
        nickname: any;
    }[];
    /** Get all topics a specific user is currently in */
    getUserTopics(id: string): string[];
    get(topic: string): {
        id: string;
        userId: any;
        nickname: any;
    }[];
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
    /** Helper to get the correct config for any topic */
    private getConfigForTopic;
    setTopicConfig(topic: string, config?: WssConfig): void;
    /** Broadcast to an array of topics */
    /**
     * Publishes an encoded payload to each unique topic within that topic's
     * configured byte limit. Bun's `-1` result is reported as backpressured,
     * `0` as dropped, and a positive result as sent.
     */
    broadcastToTopics(ws: ServerWebSocket<any>, topics: string[], data: unknown): TopicPublishResult[];
    /** Ensures all topics for a client are cleaned up on disconnect */
    cleanup(id: string): void;
}

declare const WSSMAN: WssManager;
interface WssConfig {
    maxClients?: number;
    maxPayloadSize?: number;
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

declare class Websocket<T extends Record<string, any> = Record<string, any>> {
    ws: ServerWebSocket<{}>;
    manager: subManager;
    /** Data populated by WebSocket route guards before the connection upgrades. */
    contextData: Record<string, any>;
    data: T;
    constructor();
    open(): Promise<void> | void;
    message({ text, json, topic }: wssMessage): Promise<void> | void;
    /** Called when Bun has drained buffered outbound data for this connection. */
    drain(): Promise<void> | void;
    close(code: number, reason: string): Promise<void> | void;
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
declare function wss(basePath?: string): <TTarget extends abstract new (...args: any[]) => Websocket<Record<string, any>>>(target: TTarget, context: ClassDecoratorContext<any>) => void | TTarget;

type GuardFactoryHandler<TOptions = void, ExtraCfg = Record<string, any>> = (ctx: ctx, next: () => Promise<Response> | Response, options: TOptions, Config: ErrorConfig & ExtraCfg) => Promise<Response>;
type GuardConfig = ErrorConfig & {
    id?: string | undefined;
};
type BaseConfig = Omit<ErrorConfig, "code">;
type GuardReturnType = {
    (ctx: ctx, next: () => Promise<Response> | Response): Promise<Response>;
    _middlewareId: string;
    id: string;
};
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
     * (`https://app.example.com`), hostnames (`app.example.com`), or the SDK's
     * extension form (`moz-extension://*`). Full origins are matched exactly
     * (scheme, host, and port); hostnames are matched port-agnostically.
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
        fn?: (port: number) => void;
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
    hasDefault: boolean;
    defaultIsCurrentTimestamp: boolean;
    defaultValue: string | number | boolean | null;
    constructor(type: ColumnType, precision?: number | undefined, scale?: number | undefined);
    get primary(): this;
    get notNull(): this;
    get unique(): this;
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
    createTable(db: SQL, schema: Schema<any>): Promise<void>;
    getColumns(db: SQL, schema: Schema<any>): Promise<string[]>;
    addColumn(db: SQL, schema: Schema<any>, name: string, type: string): Promise<void>;
    dropColumn(db: SQL, schema: Schema<any>, name: string): Promise<void>;
    upsert<T extends Record<string, any>>(db: SQL, schema: Schema<T>, data: T, conflictColumn: keyof T): Promise<T | undefined>;
    listTables(db: SQL): Promise<string[]>;
    dropTable(db: SQL, schema: Schema<any>): Promise<void>;
    truncateTable(db: SQL, schema: Schema<any>): Promise<void>;
    getTableStats(db: SQL, schema: Schema<any>): Promise<TableStats>;
    getTableIndices(db: SQL, schema: Schema<any>): Promise<any[]>;
    getTableSchema(db: SQL, schema: Schema<any>): Promise<any[]>;
    getTableData(db: SQL, schema: Schema<any>, limit: number, offset: number): Promise<any[]>;
    optimize(db: SQL, schema: Schema<any>): Promise<void>;
}

declare class Schema<T extends Record<string, any>> {
    readonly table: string;
    private readonly definitions;
    readonly dialect: DbDialectAdapter;
    constructor(table: string, definitions: Record<keyof T, Column>, dialect: DbDialectAdapter);
    entries(): Array<[string, Column]>;
    withDialect(dialect: DbDialectAdapter): Schema<T>;
    createSQL(adapter?: DbDialectAdapter): string;
    columnDefinitions(adapter?: DbDialectAdapter): Record<string, string>;
    get columns(): {
        [K in keyof T]: string;
    };
}

/** Shared inspection API; SQL-specific operations live in the dialect adapter. */
declare class DbInspector<T extends Record<string, any>> {
    private readonly db;
    readonly schema: Schema<T>;
    constructor(db: SQL, schema: Schema<T>);
    listTables(): Promise<string[]>;
    dropTable(): Promise<void>;
    truncateTable(): Promise<void>;
    getTableStats(): Promise<TableStats>;
    getTableIndices(): Promise<any[]>;
    getTableSchema(): Promise<any[]>;
    getTableData(limit?: number, offset?: number): Promise<any[]>;
    optimize(): Promise<void>;
    static sqlite<T extends Record<string, any>>(db: SQL, schema: Schema<T>): DbInspector<T>;
    static postgres<T extends Record<string, any>>(db: SQL, schema: Schema<T>): DbInspector<T>;
}

type Where<T> = {
    [K in keyof T]?: T[K] | {
        operator: string;
        value: unknown;
    };
};
/** Shared CRUD repository. Dialect-specific statements are delegated to its adapter. */
declare class DbRepository<T extends Record<string, any>> {
    private readonly db;
    readonly schema: Schema<T>;
    constructor(db: SQL, schema: Schema<T>);
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
    headerName?: string;
}
/**
 * Checks a CSRF header against the `csrf_token` cookie on state-changing requests.
 *
 * @param options - Optional name of the request header containing the token.
 * @returns A guard factory that accepts CSRF options and optional error config.
 */
declare const csrf: (options?: CsrfOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

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

declare class SchemaBuilder<T extends Record<string, any>> {
    private schema;
    private rules;
    private defaults;
    string(key: keyof T, defaultValue?: T[keyof T]): this;
    number(key: keyof T, defaultValue?: T[keyof T]): this;
    boolean(key: keyof T, defaultValue?: T[keyof T]): this;
    min(key: keyof T, val: number): this;
    max(key: keyof T, val: number): this;
    email(key: keyof T): this;
    private addRule;
    private noBool;
    private noKey;
    validate(data: any): {
        errors: string[];
        processedData: any;
    };
    private validateObject;
}
declare function z<T extends Record<string, any>>(): SchemaBuilder<T>;

declare const DEFAULT_MAX_SIZE: number;
/**
 * Parses and validates JSON request bodies for POST, PUT, and PATCH requests.
 * The validated value is stored on the request as `_json`.
 *
 * @param schema - Schema used to validate the parsed JSON object.
 * @returns A guard factory that accepts a schema and optional error config.
 */
declare const json: (options?: SchemaBuilder<any> | undefined, overrideConfig?: BaseConfig) => GuardReturnType;
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
};

/**
 * Persistence contract for refresh tokens.
 *
 * Implement this interface with any database, key-value store, or external
 * persistence service. `consume` must atomically remove a token and return
 * `true` only for the caller that removed it, preventing concurrent reuse.
 */
interface JwtRefreshTokenStore {
    /** Initialize the backing store or its schema when needed. */
    initialize?(): Promise<void>;
    /** Persist a refresh token until its Unix expiration time in milliseconds. */
    save(token: string, expiresAt: number): Promise<void>;
    /** Atomically remove a stored refresh token and report whether it existed. */
    consume(token: string): Promise<boolean>;
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
    /** Sign an access token using the configured access-token lifetime. */
    sign(payload: T): string;
    /** Verify an access token and return its claims, or `null` if invalid. */
    verify(token: string): JwtPayload<T> | null;
    /**
     * Atomically consume a valid, stored refresh token.
     *
     * @returns The token claims when consumption succeeds; otherwise `null`.
     */
    consume(token: string): Promise<JwtPayload<T> | null>;
    /** Issue a refresh token, persist it, and return it with a new access token. */
    issue(payload: T): Promise<{
        accessToken: string;
        refreshToken: string;
    }>;
}

/**
 * Verifies a Bearer access token and stores its decoded claims in `ctx.jwtData`.
 *
 * @param service - JWT service used to verify the access token.
 * @returns A guard factory that accepts a JWT service and optional error config.
 */
declare const jwtAuth: (options?: JWTAuthService<any> | undefined, overrideConfig?: BaseConfig) => GuardReturnType;
/**
 * Consumes an `x-refresh-token`, issues a replacement token pair, and stores
 * the authenticated claims in `ctx.jwtData` and the new tokens in
 * `ctx.data.jwtTokens`.
 *
 * @param service - JWT service used to consume and issue tokens.
 * @returns A guard factory that accepts a JWT service and optional error config.
 */
declare const jwtRefresh: (options?: JWTAuthService<any> | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

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

/**
 * Parses a multipart request and stores its fields and uploaded files in
 * `ctx.form`.
 *
 * @returns A guard factory that parses multipart form data before continuing.
 */
declare const multipart: (options?: void | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

interface QueryValidationOptions<T extends Record<string, any>> {
    schema: SchemaBuilder<T>;
}
interface FormValidationOptions<T extends Record<string, any>> {
    schema: SchemaBuilder<T>;
}
/**
 * Validates and coerces URL query parameters against a schema, then stores the
 * result in `ctx.query`.
 *
 * @param schema - Schema used to validate and coerce query values.
 * @returns A guard factory that accepts the schema and optional error config.
 */
declare const validateQuery: (options?: SchemaBuilder<{}> | undefined, overrideConfig?: BaseConfig) => GuardReturnType;
/**
 * Validates multipart or URL-encoded form fields against a schema and stores
 * the processed result in `ctx.form`.
 *
 * @param schema - Schema used to validate and coerce form values.
 * @returns A guard factory that accepts the schema and optional error config.
 */
declare const validateForm: (options?: SchemaBuilder<{}> | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

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
declare abstract class SessionAuthInterface extends SidGenerator {
    config: Required<AuthConfig>;
    constructor(config: AuthConfig, salt?: string);
    init(): Promise<void>;
    /**
     * Verifies the cryptographic signature and opens the session.
     */
    openSession(sid?: string, readonly?: boolean): Promise<ServerSide>;
    /** To be implemented by child class: Retrieve from DB */
    fetchSession(sid: string, readonly?: boolean): Promise<any>;
    abstract fetchData(sid: string, readonly?: boolean): Promise<any | undefined>;
    /** To be implemented by child class: Save to DB */
    abstract saveSession(session: ServerSide, headers: Headers): Promise<void>;
    /** To be implemented by child class: Save to DB */
    abstract deleteSession(session: ServerSide, headers: Headers): Promise<void>;
    /** Instantiates a fresh, writable session */
    new({ sid, isFound, readonly, }: newSession): ServerSide;
    /** Instantiates a read-only session */
    get readonly(): ServerSide;
    /**
     * Calculates the exact Date object when this session expires.
     */
    get getSessionExpirationDate(): Date;
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
    loadHeader(req: Request, readonly?: boolean): Promise<[string | undefined, ServerSide]>;
}

interface SessionConfig {
    auth: SessionAuthInterface;
    readonly?: boolean;
}
/**
 * Loads the request session into `ctx.session` and persists session changes
 * after downstream guards and handlers complete.
 *
 * @param auth - Session service used to load, save, and delete sessions.
 * @returns A guard factory that accepts a session service and optional error config.
 */
declare const session: (options?: SessionAuthInterface | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

/**
 * Serves requests for file-like paths through the configured static file server.
 * Only GET and HEAD requests are intercepted.
 *
 * @returns A guard factory that serves static assets before route handling.
 */
declare const staticFiles: (options?: void | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

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
    sanitizePaths?: boolean;
    patterns?: Record<string, RegExp>;
}
/**
 * Validates URL and query limits, query keys, duplicate keys, and path safety.
 *
 * @param options - URL size, query, and path validation rules.
 * @returns A guard factory that accepts validation rules and optional error config.
 */
declare const validateUrl: (options?: number | void | UrlValidationOptions | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

/**
 * Parses an URL-encoded form request and stores its fields in `ctx.form`.
 *
 * @returns A guard factory that parses URL-encoded form data before continuing.
 */
declare const urlencoded: (options?: void | undefined, overrideConfig?: BaseConfig) => GuardReturnType;

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

export { Column, DEFAULT_MAX_SIZE, DatabaseError, DbInspector, DbRepository, Field, ForeignKeyError, JWTAuthService, McpController, Methods, req as Req, res as Res, Rossa, RouterManager, Schema, SchemaBuilder, Scope, ServerSide, SessionAuthInterface, UniqueConstraintError, WSSMAN, Websocket, WssManager, apiKey, auth, authBearer, authorize, contentType, cookies, cors, createGuard, csrf, ctx, errorHandler, getDialect, header, ipFilter, json, jwtAuth, jwtRefresh, keys, logger, loggerFN, mariadbDialect, mcp, multipart, mysqlDialect, postgresDialect, rateLimit, route, sanitize, security, sendError, session, smartCache, sqliteDialect, staticFiles, subManager, t, timeout, urlencoded, use, validateForm, validateQuery, validateUrl, wss, z };
export type { AuthConfig, BaseConfig, CacheOptions, ColumnType, ContentEncodingType, ContentTypeRules, CorsOptions, CsrfOptions, DbDialectAdapter, DbDialectName, ErrorConfig, ErrorGuardOptions, FormValidationOptions, GlobalGuard, GuardConfig, GuardFactoryHandler, GuardReturnType, HeaderValidationRules, HttpRouteConfig, HttpRouteMatch, JWTConfig, JwtPayload, JwtRefreshTokenStore, McpOptions, McpServerFactory, QueryValidationOptions, RateLimitOptions, RequireKeysOptions, RossaOptions, RossaWebSocketOptions, SanitizeOptions, SecurityHeadersOptions, SessionConfig, TableStats, TopicPublishResult, TopicPublishStatus, UrlValidationOptions, Where, WssBaseController, WssConfig, WssMessageRateLimit, WssRouteConfig, dev, methodsKeys, serverOptions, wssMessage };
