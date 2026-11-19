import { DEFAULT_FILE_EXTENSIONS, isFile } from "@/core/static-server";
import type { Server, SocketAddress } from "bun";

//

export const fileExtensions = DEFAULT_FILE_EXTENSIONS;

// ---  ---------------------------------------------------------------

export class req {
  public params: Record<string, string> = {};

  private _url?: URL;
  private _query?: Record<string, string>;
  private _cookies?: Map<string, string>;
  private _formData?: FormData;
  private _json?: any;
  private _txt?: string;

  constructor(
    public readonly request: Request,
    public readonly server?: Server<unknown>,
    private readonly fileDetector: (path: string) => boolean = isFile,
  ) {}

  // --- ASYNC BODY CONSUMERS (Cached & Stream-Safe) ---

  /**
   * Caches the raw text.
   * By resolving text first, we prevent Bun's "body stream already locked" error
   * if you attempt to read .text() and .json() in the same request lifecycle.
   */
  async text(): Promise<string> {
    if (this._txt !== undefined) return this._txt;
    try {
      this._txt = await this.request.text();
      return this._txt;
    } catch {
      return (this._txt = "");
    }
  }

  /**
   * Parses JSON from the cached text to prevent stream locks.
   */
  async json<T extends Record<string, any>>(): Promise<T> {
    if (this._json !== undefined) return this._json;
    try {
      const rawText = await this.text();
      this._json = rawText ? JSON.parse(rawText) : {};
      return this._json;
    } catch {
      return (this._json = {} as T);
    }
  }

  /**
   * Parses FormData. Cannot be mixed with .text() or .json() for multipart binary uploads.
   */
  async form(): Promise<FormData> {
    if (!this.isForm) return new FormData();
    if (this._formData !== undefined) return this._formData;
    try {
      this._formData = await this.request.formData();
      return this._formData;
    } catch {
      return (this._formData = new FormData());
    }
  }

  // --- LAZY GETTERS (Computed Once & Cached) ---

  get url(): URL {
    return (this._url ??= new URL(this.request.url));
  }

  get query(): Record<string, string> {
    if (this._query) return this._query;
    // Converts URLSearchParams directly into a clean key-value object
    this._query = Object.fromEntries(this.url.searchParams.entries());
    return this._query;
  }

  get cookies() {
    if (!this._cookies) {
      const raw = this.request.headers.get("cookie");
      this._cookies = new Map();
      if (raw) {
        raw.split(";").forEach((pair) => {
          const [key, ...val] = pair.trim().split("=");
          this._cookies!.set(key!, val.join("="));
        });
      }
    }
    return this._cookies;
  }

  get auth(): string | undefined {
    const header = this.request.headers.get("authorization");
    if (!header?.startsWith("Bearer ")) return undefined;
    return header.substring(7);
  }

  // --- PROXIES & UTILITIES ---

  get method(): string {
    return this.request.method.toUpperCase();
  }

  get headers(): Headers {
    return this.request.headers;
  }

  /**
   * Helper to grab a specific header safely.
   */
  header(key: string): string | null {
    return this.request.headers.get(key);
  }

  get ip(): SocketAddress | null {
    return this.server?.requestIP(this.request) ?? null;
  }

  get path(): string {
    return this.url.pathname;
  }

  // --- STATE BOOLEANS ---

  get isForm(): boolean {
    const ct = this.request.headers.get("content-type");
    return (
      !!ct &&
      (ct.includes("multipart/form-data") ||
        ct.includes("application/x-www-form-urlencoded"))
    );
  }

  get isWSS(): boolean {
    return this.request.headers.get("upgrade")?.toLowerCase() === "websocket";
  }

  get isEventStream(): boolean {
    if (this.request.method.toUpperCase() !== "GET") return false;

    return (this.request.headers.get("accept") ?? "")
      .split(",")
      .some((range) => {
        const [mediaType, ...parameters] = range.trim().split(";");
        if (mediaType?.trim().toLowerCase() !== "text/event-stream")
          return false;

        for (const parameter of parameters) {
          const match = parameter
            .trim()
            .match(/^q\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)$/i);
          if (match && Number(match[1]) === 0) return false;
        }
        return true;
      });
  }

  /**
   * Infers if the route is a static file by checking for an extension in the last URL segment.
   */
  get isFile(): boolean {
    return this.fileDetector(this.path);
  }

  // --- ACTIONS ---

  async getAuthCredentials() {
    const formData = this.isForm ? await this.form() : null;
    return {
      sid: this.cookies.get("session") ?? "",
      jwt: this.auth ?? "",
      refresh: formData?.get("refresh_token")?.toString() ?? "",
    };
  }

  upgrade<T = any>(data: T = {} as T): boolean {
    return this.server?.upgrade(this.request, { data }) ?? false;
  }
}
