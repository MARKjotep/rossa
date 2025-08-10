import { ServerSide, Auth } from 'authored';
import * as bun from 'bun';
import { Server, ServerWebSocket, WebSocketHandler, Serve } from 'bun';

type obj<T> = Record<string, T>;

/**
 * A custom Map implementation that provides additional utility methods for working with objects and maps.
 *
 * @template K - The type of the keys in the map.
 * @template V - The type of the values in the map.
 */
declare class Mapper<K, V> extends Map<K, V> {
    obj(obj?: object | null): void;
    map(map: Mapper<K, V>): void;
    ass<T>(key: K, obj: T): void;
    lacks(key: K): boolean;
    init(key: K, val: V): V;
}

declare class log {
    static set i(a: any);
    static set e(a: any);
    static set w(a: any);
}

declare class Time {
    date: Date;
    constructor(dateMS?: number);
    delta(date2?: number | null, _Date?: boolean): number | Date;
    timed(time?: {
        year?: number;
        month?: number;
        day?: number;
        hour?: number;
        minute?: number;
        second?: number;
    }): Date;
    static delta(date1: number, date2?: number | null): number;
    static local(date: number): string;
    static get now(): number;
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
    json<T extends {}>(): Promise<T>;
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
    get hash(): string;
    get fullPath(): string;
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
    hash: string;
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
    broadcast?: boolean;
    maxClient?: number;
    requireSession?: boolean;
}

declare class routeCFG {
    files: (...file: ([string, pathConfig] | string)[]) => void;
    statics: (statics?: obj<Response>) => void;
    /** --------------------
     * string | int | float | file | uuid
     * - /url/\<string:hell>
     */
    route: (path: string) => <T extends typeof response>(f?: T | undefined) => T | undefined;
    wss: (path: string, config?: wssConfig) => <T extends typeof websocket>(f?: T | undefined) => T | undefined;
    error: (...codes: number[]) => <T extends typeof response>(f?: T | undefined) => T | undefined;
    folders: (...folder: ([
        string,
        {
            requireSession?: boolean;
        }
    ] | string)[]) => void;
    redirect: (url: string, headers?: obj<string>) => Response;
}
declare class Formula extends routeCFG {
    dir: string;
    apt: string;
    base: string;
    protected _statics?: obj<Response>;
    constructor(dir?: string, options?: yveOptions);
    protected _base(str: string): string;
}

interface yveOptions {
    dir?: string;
    clientDir?: string;
    envPath?: string;
    session?: Auth;
    base?: string;
}
type for_srver = Partial<Serve> & dev & {
    fn?: (port: number) => void;
};
type _server = (server?: for_srver, wss?: Partial<WebSocketHandler>) => Promise<void>;
declare class Rossa extends Formula {
    html: (server?: dev & {
        name?: string;
    }) => Promise<void>;
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

interface fs {
    [key: string]: string | undefined | boolean | number;
}
declare class JSONCacher<T extends fs> {
    fs: string;
    f_timed: number;
    data: Map<any, T>;
    key: string;
    dir: string;
    constructor({ dir, fs, key }: {
        dir: string;
        fs: string;
        key: string;
    });
    init(): Promise<void>;
    get(val: string | undefined): Promise<T | null>;
    queue(): Promise<void>;
    set(data: T): Promise<boolean>;
    delete(key: string): Promise<void>;
    json(): Promise<any>;
}

interface dev {
    path?: string;
    hostname?: string;
    method?: string;
    port?: number;
}

export { JSONCacher, Mapper, Render, Rossa, Time, auths, log, response, websocket };
export type { dev };
