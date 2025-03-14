import { BunFile, deflateSync, gzipSync, Server } from "bun";
import { request } from "../request";
import { UPGRADE } from "../wss";
import { $$, addBASE, obj, oItems } from "../@";
import { PATH, ERROR } from "../response";

export type responseBody =
  | string
  | Uint8Array
  | ArrayBuffer
  | BunFile
  | ReadableStream<Uint8Array>
  | null;

class Pres {
  status: number = 404;
  headers: Headers = new Headers({
    "Content-Type": "text/plain",
  });
  set header(head: obj<string>) {
    oItems(head).forEach(([k, v]) => {
      this.headers.set(k, v);
    });
  }
  set type(content: string) {
    this.headers.set("Content-Type", content);
  }
  options(options: string) {
    options += ", OPTIONS";
    this.header = {
      Allow: options,
      "Access-Control-Allow-Methods": options,
      "Access-Control-Max-Age": "86400",
    };
    return null;
  }
  compress(type: "gzip" | "deflate", ctx: Uint8Array | string | ArrayBuffer) {
    const compress = type === "gzip" ? gzipSync : deflateSync;
    const buffd = compress(ctx);
    this.header = {
      "Content-Length": buffd.byteLength.toString(),
      "Content-Encoding": type,
    };
    return buffd;
  }
  get init() {
    return { status: this.status, headers: this.headers };
  }
}

export class Runner extends Pres {
  request: request;
  path: string = "";
  constructor(
    req: Request,
    server?: Server,
    public dir: string = "./",
    public base: string = "",
  ) {
    super();
    this.request = new request(req, server);
  }
  async response() {
    const { path, isWSS } = this.request;

    this.path = this._base(path);

    let ctx = await (isWSS ? UPGRADE : PATH).call(this);

    if (!ctx) {
      ctx = await ERROR.call(this);
    }

    return new Response(ctx, this.init);
  }
  protected _base(str: string) {
    return addBASE(this.base, str);
  }
}
