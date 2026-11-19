import type { ServerWebSocket } from "bun";
import type { wssMessage } from "./config.wss";
import type { subManager } from "./wss-manager";

// src/engines/framework/primitives/websocket.ts
export class Websocket<T extends Record<string, any> = Record<string, any>> {
  // We pass the native Bun `ws` instance so you can call ws.send() inside your methods
  declare ws: ServerWebSocket<{}>;
  declare public manager: subManager;
  /** Data populated by WebSocket route guards before the connection upgrades. */
  contextData: Record<string, any> = {};
  data: T = {} as T;
  constructor() {}

  open(): Promise<void> | void {}
  message({ text, json, topic }: wssMessage): Promise<void> | void {}
  /** Called when Bun has drained buffered outbound data for this connection. */
  drain(): Promise<void> | void {}
  close(code: number, reason: string): Promise<void> | void {}

  set send(message: string | Bun.BufferSource) {
    this.ws.send(message);
  }
}
