import { Server, file } from "bun";
import { Cached, obj, parsePath, pathType } from "../@";

@Cached
export class request {
  formData?: FormData;
  url: URL;
  method: string;
  __cookies: Map<string, string> = new Map();
  constructor(
    public req: Request,
    public server?: Server,
  ) {
    this.url = new URL(req.url);
    this.method = this.req.method.toLowerCase();
    /*
    -------------------------
    -------------------------
    */
  }
  async json<T extends {}>(): Promise<T> {
    return await this.req.json();
  }
  async form(): Promise<FormData> {
    if (this.isForm) {
      if (!this.formData) {
        this.formData = await this.req.formData();
      }
      return this.formData;
    }
    return new FormData();
  }
  async authgroup() {
    const { cookies: cookies, auth } = this;
    let sid = cookies.get("session") ?? "";
    let jwtv = auth ?? "";
    let refreshjwt: string = "";

    const tf = this.isForm ? await this.form() : undefined;
    if (tf) {
      const rt = tf.get("refresh_token");
      refreshjwt = rt ? rt.toString() : "";
    }

    return { sid, jwtv, refreshjwt };
  }
  upgradeConnection(data: obj<any> = {}) {
    return !!this.server?.upgrade(this.req, data);
  }
  // -----------------------
  get auth() {
    const auth = this.headers.get("authorization");
    if (auth) {
      const [bear, token] = auth.split(" ", 2);
      if (bear.trim() == "Bearer") {
        return token.trim();
      }
    }
  }
  get accept() {
    return this.headers.get("accept");
  }
  get contentType() {
    return this.headers.get("content-type");
  }
  get cookies() {
    if (!this.__cookies.size) {
      const cookie = this.headers.get("cookie");
      if (cookie) {
        const CS = cookie.split(";").reduce<[string, string][]>((ob, d) => {
          const [key, val] = d.trim().split(/=(.*)/s);
          ob.push([key, val]);
          return ob;
        }, []);
        this.__cookies = new Map(CS);
      }
    }
    return this.__cookies;
  }
  get headers() {
    return this.req.headers ?? new Headers();
  }
  get ip() {
    return this.server?.requestIP(this.req);
  }
  get isForm() {
    const ctype = this.contentType;
    return ctype
      ? ctype.indexOf("multipart/form-data") >= 0 ||
          ctype.indexOf("x-www-form-urlencoded") >= 0
      : false;
  }
  get path() {
    return this.url.pathname;
  }
  get hash() {
    return this.url.hash;
  }
  get fullPath() {
    const { pathname, hash } = this.url;
    return pathname + hash;
  }
  get parsed() {
    const { parsed } = parsePath(this.path);
    return parsed;
  }
  get searchParams() {
    return this.url.searchParams;
  }
  get range() {
    return this.headers.get("range") ?? undefined;
  }
  get isEventStream() {
    const f = "text/event-stream";
    return this.accept?.includes(f);
  }
  get isWSS() {
    return !!this.headers.get("upgrade");
  }
  get isFile() {
    const ppop = this.parsed.slice().pop();
    return ppop ? pathType(ppop, true).pop() === "file" : false;
  }
  get type() {
    return file(this.path).type;
  }
  get upgrade() {
    return this.headers.get("upgrade");
  }
  get request() {
    return this.req;
  }
  get signal() {
    return this.req.signal;
  }
}
