import { TopicCapacityError, subManager, WssManager } from "./wss-manager";
import { Websocket } from "./websocket.wss";

export const WSSMAN = new WssManager();

export interface WssConfig {
  /**
   * Maximum members in this topic. Checked before the HTTP upgrade for topics
   * returned by `Websocket.capacityTopics()` (over-capacity upgrades answer
   * `503`), and again by `subscribe()` as the late-join fallback.
   */
  maxClients?: number;
  /** Maximum broadcast payload bytes for this topic. */
  maxPayloadSize?: number;
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
      instance.manager = new subManager(
        ws,
        instance.contextData.chatUser?.nickname,
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
