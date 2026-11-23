import type { ServerWebSocket } from "bun";
import type { ctx } from "../http/ctx";
import type { wssMessage } from "./config.wss";
import type { subManager } from "./wss-manager";

/**
 * Data Bun keeps on a WebSocket connection after `WSSMAN.register` runs.
 *
 * `id` and `nickname` are added by registration, while `instance` and
 * `contextData` come from the router's upgrade payload. `contextData` is the
 * same object a guard populated as `ctx.data` before the handshake.
 */
export interface WssSocketData {
  /** Connection id assigned by `WSSMAN.register`. */
  id: string;
  /** Display name passed to `WSSMAN.register` (usually the guard identity's nickname). */
  nickname?: string;
  /** Guard-populated `ctx.data` copied before the upgrade. */
  contextData?: Record<string, any>;
  /** Controller instance bound to this connection. */
  instance?: Websocket<any, any>;
}

/**
 * Resolves the guard-populated identity for a WebSocket connection.
 *
 * Lookup order: `contextData.user`, `contextData.chatUser` (the chat examples'
 * key), `contextData.principal` (the transport smoketest's key), then
 * `data.user`. The first defined value is returned; an empty object is used
 * when no guard attached an identity.
 */
export function resolveSocketIdentity(
  contextData?: Record<string, any>,
  data?: Record<string, any>,
): unknown {
  const context = contextData ?? {};
  return (
    context.user ?? context.chatUser ?? context.principal ?? data?.user ?? {}
  );
}

/** Reads a `nickname` string from a resolved identity, if it has one. */
export function socketIdentityNickname(identity: unknown): string | undefined {
  if (!identity || typeof identity !== "object") return undefined;
  const nickname = (identity as { nickname?: unknown }).nickname;
  return typeof nickname === "string" ? nickname : undefined;
}

// src/engines/framework/primitives/websocket.ts
/**
 * Base class for WebSocket controllers.
 *
 * @typeParam TData - Per-connection state stored on `this.data`.
 * @typeParam TIdentity - Guard-populated identity exposed as `this.user`
 * (resolved from `contextData.user`, `contextData.chatUser`,
 * `contextData.principal`, or `ws.data.user`). Defaults to
 * `Record<string, any>`, so untyped use keeps working.
 */
export class Websocket<
  TData extends Record<string, any> = Record<string, any>,
  TIdentity = Record<string, any>,
> {
  // We pass the native Bun `ws` instance so you can call ws.send() inside your methods
  declare ws: ServerWebSocket<WssSocketData>;
  declare public manager: subManager;
  /** Data populated by WebSocket route guards before the connection upgrades. */
  contextData: Record<string, any> = {};
  data: TData = {} as TData;
  /**
   * Guard-populated identity resolved from the upgrade's `contextData`
   * (`user`, `chatUser`, or `principal`) or `ws.data.user`. Empty object when
   * no guard attached one. Available from `open()` onwards.
   */
  declare user: TIdentity;
  /**
   * Query string of the WebSocket handshake URL (for example
   * `/chat?room=lobby` → `room=lobby`). Captured by the default
   * {@link capacityTopics} implementation, so subclasses that override
   * `capacityTopics` should call `super.capacityTopics(ctx)` to keep it
   * populated.
   */
  query: URLSearchParams = new URLSearchParams();
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
   * The default implementation also snapshots `ctx.url.searchParams` into
   * {@link query}; when you override it, call `super.capacityTopics(ctx)` if
   * you rely on `this.query`.
   *
   * Configure the topic's `maxClients` before the upgrade (module scope, a
   * guard, or `WSSMAN.setTopicConfig`) — `open()` has not run yet when this is
   * called.
   */
  capacityTopics(ctx: ctx): string[] {
    this.query = new URLSearchParams(ctx.url.searchParams);
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
