import type { ServerWebSocket } from "bun";
import type { ctx } from "../http/ctx";
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

  /**
   * Topics whose `maxClients` should be checked before the HTTP upgrade.
   *
   * Override this to let Rossa reject an over-capacity handshake with `503`
   * instead of accepting a socket that cannot subscribe. The upgrade has not
   * happened yet, so `this.ws` and `this.manager` are not available; use the
   * `ctx` argument (guards have already populated `ctx.data`) or the instance's
   * `contextData`.
   *
   * Return an empty array (the default) when the topic is only known after the
   * handshake. In that case `subManager.subscribe()` still enforces
   * `maxClients` and throws `TopicCapacityError`.
   *
   * Configure the topic's `maxClients` before the upgrade (module scope, a
   * guard, or `WSSMAN.setTopicConfig`) — `open()` has not run yet when this is
   * called.
   */
  capacityTopics(_ctx: ctx): string[] {
    return [];
  }

  open(): Promise<void> | void {}
  message({ text, json, topic }: wssMessage): Promise<void> | void {}
  /** Called when Bun has drained buffered outbound data for this connection. */
  drain(): Promise<void> | void {}

  /**
   * Disconnect lifecycle hook, called by Rossa when Bun reports the socket
   * closed. Runs **before** `manager.cleanup()`, so subscriptions, topics and
   * admin flags are still readable here.
   *
   * This method is a notification callback, not a way to close the socket.
   * Use {@link terminate} (or `this.ws.close`) to close from application code.
   */
  onClose(code: number, reason: string): Promise<void> | void {}

  /**
   * @deprecated Override {@link onClose} instead. This alias is still invoked
   * on disconnect when a subclass overrides `close()` without overriding
   * `onClose()`, and runs before `manager.cleanup()`.
   */
  close(code: number, reason: string): Promise<void> | void {}

  /**
   * Closes this connection from application code.
   *
   * Bun then reports the close, so `onClose(code, reason)` runs first and
   * `manager.cleanup()` follows. Defaults to a normal `1000` closure.
   */
  terminate(code: number = 1000, reason: string = ""): void {
    this.ws.close(code, reason);
  }

  set send(message: string | Bun.BufferSource) {
    this.ws.send(message);
  }
}
