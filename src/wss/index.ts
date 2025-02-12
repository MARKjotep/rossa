import { ServerWebSocket } from "bun";
import { makeID, Mapper } from "../@";
import { request } from "../request";
import { ResponseSession } from "../session";
import { STORAGE } from "./storage";
export { socketConfig } from "./config";
export { UPGRADE } from "./upgrade";

export class websocket extends ResponseSession {
  [Key: string]: any;
  ws!: ServerWebSocket<{ wclass: websocket }>;
  path: string;
  id: string;
  broadcasting = false;
  max: number = 0;
  constructor(public request: request) {
    super();
    this.path = request.path;
    this.id = makeID(10);
  }
  async init?(...args: any[]): Promise<void>;
  open(): Promise<void> | void {}
  message(message: string | Buffer | undefined): Promise<void> | void {}
  close(code: number, reason: string): Promise<void> | void {}
  set send(message: string | Bun.BufferSource | undefined) {
    if (message)
      if (this.broadcasting) {
        this.ws.publish(this.path, message);
      } else {
        this.ws.send(message);
      }
  }
  get role() {
    const WT = STORAGE.get(this.path);
    if (WT && WT.has(this.id)) {
      return WT.get(this.id)?.role;
    }
  }
}

export const getClient = (rurl: string) => {
  return STORAGE.init(rurl, new Mapper());
};
