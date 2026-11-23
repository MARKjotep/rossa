import { DEFAULT_FILE_EXTENSIONS, isFile } from "@/core/static-server";
import { DEFAULT_MAX_SIZE } from "@/guard/shared/body-cap.util";
import type { Server, SocketAddress } from "bun";

//

export const fileExtensions = DEFAULT_FILE_EXTENSIONS;

/** Options accepted by {@link req.autoBody}. */
export interface AutoBodyOptions {
  /**
   * Maximum accepted request-body size in bytes.
   *
   * @default 1048576 (1 MiB, the shared `DEFAULT_MAX_SIZE`)
   */
  maxSize?: number;
}

/** Content-type-aware body selected by {@link req.autoBody}. */
export interface AutoBodyResult<T = unknown> {
  /**
   * Parsed body: an object/array for JSON, `FormData` for form content types,
   * or the raw string for anything else. `null` when the request had no body.
   */
  body: T | string | null;
  /** How the body was interpreted. */
  parsedWith: "json" | "form" | "text" | "empty";
}

// ---  ---------------------------------------------------------------

export class req {
  public params: Record<string, string> = {};

  private _url?: URL;
  private _query?: Record<string, string>;
  private _cookies?: Map<string, string>;
  private _formData?: FormData;
  private _json?: any;
  private _txt?: string;
  private _autoBody?: AutoBodyResult<any>;

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
  async autoBody<T = unknown>(
    options: AutoBodyOptions = {},
  ): Promise<AutoBodyResult<T>> {
    if (this._autoBody !== undefined) {
      return this._autoBody as AutoBodyResult<T>;
    }

    const maxSize =
      typeof options.maxSize === "number" && options.maxSize > 0
        ? options.maxSize
        : DEFAULT_MAX_SIZE;

    const declaredLength = this.headers.get("content-length");
    if (declaredLength !== null) {
      if (!/^\d+$/.test(declaredLength)) {
        throw new Error("Invalid Content-Length header");
      }
      if (Number(declaredLength) > maxSize) {
        throw new Error(
          `Payload exceeded maximum allowed size of ${maxSize / 1024} KB`,
        );
      }
    }

    const contentType = (this.headers.get("content-type") ?? "")
      .split(";", 1)[0]!
      .trim()
      .toLowerCase();

    let result: AutoBodyResult<any>;

    if (this.isForm) {
      const form = await this.form();
      const firstEntry = form.entries().next();

      result = firstEntry.done
        ? { body: null, parsedWith: "empty" }
        : { body: form, parsedWith: "form" };
    } else {
      const raw = await this.text();
      const byteLength = new TextEncoder().encode(raw).byteLength;

      if (byteLength > maxSize) {
        throw new Error(
          `Payload exceeded maximum allowed size of ${maxSize / 1024} KB`,
        );
      }

      if (raw.length === 0) {
        result = { body: null, parsedWith: "empty" };
      } else if (
        contentType === "application/json" ||
        contentType.endsWith("+json")
      ) {
        try {
          result = { body: JSON.parse(raw), parsedWith: "json" };
        } catch {
          // Malformed JSON is reported as text rather than rejected.
          result = { body: raw, parsedWith: "text" };
        }
      } else {
        result = { body: raw, parsedWith: "text" };
      }
    }

    this._autoBody = result;
    return result as AutoBodyResult<T>;
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
