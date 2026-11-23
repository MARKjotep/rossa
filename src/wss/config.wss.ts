import { TopicCapacityError, subManager, WssManager } from "./wss-manager";
import {
  Websocket,
  resolveSocketIdentity,
  socketIdentityNickname,
} from "./websocket.wss";

export const WSSMAN = new WssManager();

/** Default number of stored frames replayed when a topic does not set `limit`. */
export const DEFAULT_TOPIC_HISTORY_LIMIT = 50;

/**
 * Persistence adapter for {@link WssHistoryConfig}.
 *
 * The application owns the frame shape: whatever object or string it passes to
 * `broadcast()` is what Rossa hands to `save()` and, later, replays exactly as
 * `recent()` returned it.
 */
export interface TopicHistoryStore {
  /**
   * Persists one accepted broadcast frame for a topic.
   *
   * Called after the frame passed the topic's payload-size check and the
   * optional `persist` filter. Return a promise to make writes asynchronous;
   * Rossa orders subsequent saves per topic and waits for them before replay.
   */
  save(topic: string, frame: unknown): Promise<void> | void;
  /**
   * Returns up to `limit` stored frames for a topic, **oldest → newest**.
   * Rossa sends them in the returned order on join (subject to `replay`).
   */
  recent(topic: string, limit: number): Promise<unknown[]>;
}

/**
 * Pluggable per-topic history/backlog.
 *
 * When configured, Rossa saves accepted broadcast frames (after the payload
 * check and the optional `persist` filter) and, by default, replays
 * `recent(topic, limit)` oldest → newest to a socket when it joins the topic.
 * Presence frames and replayed frames are never persisted.
 */
export interface WssHistoryConfig {
  /** Persistence adapter that stores and later reads frames. */
  store: TopicHistoryStore;
  /**
   * Maximum number of frames requested from `store.recent()` on join.
   * Defaults to {@link DEFAULT_TOPIC_HISTORY_LIMIT} (`50`).
   */
  limit?: number;
  /**
   * Replay stored frames to a socket when it joins the topic. Defaults to
   * `true`; set `false` to persist without replaying.
   */
  replay?: boolean;
  /**
   * Filter deciding which accepted frames are persisted. Receives the frame
   * exactly as passed to `broadcast()`. Defaults to persisting every accepted
   * frame; returning `false` skips the frame.
   */
  persist?: (frame: unknown) => boolean;
}

/**
 * Per-topic presence frame switches.
 *
 * An object opts in to both event kinds; set a key to `false` to suppress it.
 */
export interface WssPresenceOptions {
  /** Emit a `join` frame when a socket subscribes. Defaults to `true`. */
  join?: boolean;
  /** Emit a `leave` frame when a socket unsubscribes/cleans up. Defaults to `true`. */
  leave?: boolean;
}

export interface WssConfig {
  /**
   * Maximum members in this topic. Checked before the HTTP upgrade for topics
   * returned by `Websocket.capacityTopics()` (over-capacity upgrades answer
   * `503`), and again by `subscribe()` as the late-join fallback.
   */
  maxClients?: number;
  /** Maximum broadcast payload bytes for this topic. */
  maxPayloadSize?: number;
  /**
   * Emit automatic `{ type: "join" | "leave", topic, member, members }`
   * presence frames for this topic. `true` enables both events;
   * `{ join?, leave? }` enables either selectively.
   *
   * Defaults to **off**: a topic without this option emits no extra frames, so
   * existing broadcasts and handshakes are byte-identical. Join frames are
   * delivered to the joining socket as well as the other members; leave frames
   * go to the remaining members after the departed socket is removed.
   */
  presence?: boolean | WssPresenceOptions;
  /**
   * Pluggable topic history/backlog. Accepted broadcast frames are saved
   * through `store` (subject to `persist`) and, unless `replay` is `false`,
   * replayed oldest → newest to joining sockets. Frames are replayed exactly
   * as `recent()` returned them, with `replay: true` **not** injected.
   *
   * Defaults to undefined: no persistence and no replay.
   */
  history?: WssHistoryConfig;
}

/** Fixed-window incoming message limit applied independently to each socket. */
export interface WssMessageRateLimit {
  /** Maximum messages accepted from each connection during one window. */
  max: number;
  /** Fixed-window duration in milliseconds. */
  windowMs: number;
}

const deprecatedCloseWarnings = new WeakSet<Function>();

function warnDeprecatedClose(handler: Function) {
  if (deprecatedCloseWarnings.has(handler)) return;
  deprecatedCloseWarnings.add(handler);
  console.warn(
    "[rossa] Websocket.close() is deprecated; override onClose(code, reason) instead.",
  );
}

export function createSocketConfig(messageRateLimit?: WssMessageRateLimit) {
  if (
    messageRateLimit &&
    (!Number.isSafeInteger(messageRateLimit.max) ||
      messageRateLimit.max < 1 ||
      !Number.isFinite(messageRateLimit.windowMs) ||
      messageRateLimit.windowMs <= 0)
  ) {
    throw new RangeError("Invalid WebSocket message rate limit");
  }

  const counters = new WeakMap<object, { count: number; resetAt: number }>();

  const canReceiveMessage = (ws: object): boolean => {
    if (!messageRateLimit) return true;

    const now = Date.now();
    const current = counters.get(ws);
    if (!current || now >= current.resetAt) {
      counters.set(ws, { count: 1, resetAt: now + messageRateLimit.windowMs });
      return true;
    }
    if (current.count >= messageRateLimit.max) return false;
    current.count += 1;
    return true;
  };

  return {
    open: async (ws: any) => {
      const { instance, contextData } = ws.data;

      instance.ws = ws;
      instance.contextData = contextData ?? {};
      instance.user = resolveSocketIdentity(instance.contextData, ws.data);
      instance.manager = new subManager(
        ws,
        socketIdentityNickname(instance.user),
      );
      try {
        await instance.open();
      } catch (error) {
        // Fallback for a socket that still raced into `open` without a
        // pre-upgrade slot: close it instead of leaving it subscribed-free.
        if (error instanceof TopicCapacityError) {
          ws.close(1008, "Topic capacity reached");
          return;
        }
        throw error;
      }
    },

    message: async (ws: any, message: string | Buffer) => {
      if (!canReceiveMessage(ws)) {
        ws.close(1008, "Message rate limit exceeded");
        return;
      }

      const { instance } = ws.data;

      await instance.message(autoParse(message));
    },

    drain: async (ws: any) => {
      const { instance } = ws.data;
      await instance.drain();
    },

    close: async (ws: any, code: number, reason: string) => {
      const { instance } = ws.data;
      try {
        await instance.onClose(code, reason);

        // Backward compatibility: subclasses written before `onClose` still
        // override `close()`. Call it only when they did not also override
        // the new hook, so a subclass never runs both.
        if (
          instance.onClose === Websocket.prototype.onClose &&
          instance.close !== Websocket.prototype.close
        ) {
          warnDeprecatedClose(instance.close);
          await instance.close(code, reason);
        }
      } finally {
        instance.manager.cleanup();
      }
    },
  };
}

/** Default socket lifecycle handlers without an application message limit. */
export const socketConfig = createSocketConfig();

export type wssMessage<T extends Record<string, any> = Record<string, any>> = {
  text: string;
  json: T;
  topic?: string | undefined;
};

function autoParse(message: any): wssMessage {
  let str = typeof message === "string" ? message : message.toString();

  let json: any = {};
  let topic: string | undefined = undefined;
  try {
    const { topic: _topic, ..._json } = JSON.parse(str);
    json = _json;
    topic = typeof _topic === "string" && _topic.length > 0 ? _topic : undefined;
    str = "";
  } catch {}

  return {
    text: str,
    json: json,
    topic,
  };
}
