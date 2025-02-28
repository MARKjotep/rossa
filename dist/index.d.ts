import { ServerSide, Auth } from 'authored';
import * as bun from 'bun';
import { Server, ServerWebSocket, Serve, WebSocketHandler } from 'bun';

type obj<T> = Record<string, T>;

declare class $$ {
    static set p(a: any);
}

declare class session {
    session: obj<string>;
    jwt: obj<string>;
    timedJWT: ServerSide;
}
declare class ResponseSession implements session {
    __session?: ServerSide;
    __jwt?: ServerSide;
    get session(): ServerSide;
    set session(sesh: ServerSide);
    get jwt(): ServerSide;
    set jwt(jwt: ServerSide);
    get timedJWT(): ServerSide;
    setServerSession(rsp: ResponseSession): void;
}
declare const auths: {
    session<T>(...arg: any[]): any;
    jwt<T>(...arg: any[]): any;
    jwt_refresh<T>(...arg: any[]): any;
};

declare class request {
    req: Request;
    server?: Server | undefined;
    formData?: FormData;
    url: URL;
    method: string;
    __cookies: Map<string, string>;
    constructor(req: Request, server?: Server | undefined);
    form(): Promise<FormData>;
    authgroup(): Promise<{
        sid: string;
        jwtv: string;
        refreshjwt: string;
    }>;
    upgradeConnection(data?: obj<any>): boolean;
    get auth(): string | undefined;
    get accept(): string | null;
    get contentType(): string | null;
    get cookies(): Map<string, string>;
    get headers(): Headers;
    get ip(): bun.SocketAddress | null | undefined;
    get isForm(): boolean;
    get path(): string;
    get parsed(): string[];
    get searchParams(): URLSearchParams;
    get range(): string | undefined;
    get isEventStream(): boolean | undefined;
    get isWSS(): boolean;
    get isFile(): boolean;
    get type(): string;
    get upgrade(): string | null;
    get request(): Request;
    get signal(): AbortSignal;
}

declare class eStream {
    ctrl?: ReadableStreamDefaultController<any> | undefined;
    intervalID: Timer[];
    constructor(ctrl?: ReadableStreamDefaultController<any> | undefined);
    push(fn: () => {
        id: string | number;
        data: string | Record<string, string>;
        event?: string;
        retry?: number;
        end?: boolean;
    }, interval?: number | 1000): void;
    close(): void;
}

declare class response extends ResponseSession implements response {
    request: request;
    args: Record<string, string>;
    [key: string]: any;
    status?: number;
    stream?: eStream;
    path: string;
    private headers;
    constructor(request: request, args?: Record<string, string>);
    get?(): Promise<any> | any;
    post?(): Promise<any> | any;
    put?(): Promise<any> | any;
    patch?(): Promise<any> | any;
    eventStream?(): Promise<any> | any;
    set header(head: obj<string>);
    get header(): obj<string>;
    set type(content: string);
    setCookie({ key, val, path, days, httpOnly, }: {
        key: string;
        val: string;
        path?: string;
        days?: number;
        httpOnly?: boolean;
    }): void;
    deleteCookie(key: string): void;
}

declare class websocket extends ResponseSession {
    request: request;
    [Key: string]: any;
    ws: ServerWebSocket<{
        wclass: websocket;
    }>;
    path: string;
    id: string;
    broadcasting: boolean;
    max: number;
    constructor(request: request);
    init?(...args: any[]): Promise<void>;
    open(): Promise<void> | void;
    message(message: string | Buffer | undefined): Promise<void> | void;
    close(code: number, reason: string): Promise<void> | void;
    set send(message: string | Bun.BufferSource | undefined);
    get role(): "maker" | "joiner" | "god" | undefined;
}

interface pathConfig {
    requireSession?: boolean;
    preload?: boolean;
}
interface wssConfig {
    credentials?: boolean;
    broadcast?: boolean;
    maxClient?: number;
    requireSession?: boolean;
}

declare class Formula {
    dir: string;
    apt: string;
    files: (...file: ([string, pathConfig] | string)[]) => void;
    _statics?: obj<Response>;
    statics: (statics?: obj<Response>) => void;
    constructor(dir?: string, options?: yveOptions);
    /** --------------------
     * string | int | float | file | uuid
     * - /url/\<string:hell>
     */
    route(path: string): <T extends typeof response>(f?: T | undefined) => T | undefined;
    wss(path: string, config?: wssConfig): <T extends typeof websocket>(f?: T | undefined) => T | undefined;
    error(...codes: number[]): <T extends typeof response>(f?: T) => T | undefined;
    folders(...folder: ([string, {
        requireSession?: boolean;
    }] | string)[]): void;
    redirect(url: string, headers?: obj<string>): Response;
}

interface dev {
    path?: string;
    hostname?: string;
    method?: string;
    port?: number;
}

interface yveOptions {
    dir?: string;
    appDir?: string;
    envPath?: string;
    session?: Auth;
}
type _server = (server?: Partial<Serve> & dev, wss?: Partial<WebSocketHandler>) => void;
declare class Rossa extends Formula {
    index: (server?: dev) => void;
    serve: _server;
    constructor(options?: yveOptions);
}

declare class Render<T> {
    type: "yra" | "jwt";
    render: T;
    data: obj<any>;
    private constructor();
    static jwt(jwtSession: any): Promise<Render<ServerSide>>;
}

export { $$, Render, Rossa, auths, response, websocket };
