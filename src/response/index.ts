import {
  $$,
  _htmlHead,
  headType,
  Mapper,
  oAss,
  obj,
  setCookie,
  Time,
} from "../@";
import { request } from "../request";
import { ResponseSession } from "../session";
import { eStream } from "./estream";

export * from "./estream";
export * from "./jwt";
export * from "./path";
export * from "./html";
export * from "./error";

export type responses = string | Response | Record<string, any> | void;

export class response extends ResponseSession implements response {
  [key: string]: any;
  status?: number;
  stream?: eStream;
  path: string;
  private headers: obj<string> = {};
  constructor(
    public request: request,
    public args: Record<string, string> = {},
  ) {
    super();

    this.path = request.path;
  }
  get?(): Promise<any> | any;
  post?(): Promise<any> | any;
  put?(): Promise<any> | any;
  patch?(): Promise<any> | any;
  eventStream?(): Promise<any> | any;
  /* ------------------------- */
  set header(head: obj<string>) {
    oAss(this.headers, head);
  }
  get header() {
    return this.headers;
  }
  set type(content: string) {
    this.header = { "Content-Type": content };
  }
  setCookie({
    key,
    val,
    path = "/",
    days = 31,
    httpOnly = false,
  }: {
    key: string;
    val: string;
    path?: string;
    days?: number;
    httpOnly?: boolean;
  }) {
    const cd = setCookie(key, val, {
      expires: new Time().timed({ day: days }),
      path: path,
      httpOnly: httpOnly,
      sameSite: "Strict",
    });
    this.header = { "Set-Cookie": cd };
  }
  deleteCookie(key: string) {
    this.setCookie({ key: key, val: "", days: 0 });
  }
}
