import {
  DEFAULT_TOPIC_HISTORY_LIMIT,
  WSSMAN,
  type WssConfig,
  type WssHistoryConfig,
} from "./config.wss";
import type { ServerWebSocket } from "bun";
import { resolveSocketIdentity } from "./websocket.wss";

export type TopicPublishStatus =
  "sent" | "backpressured" | "dropped" | "oversize";

/**
 * Outcome of publishing one payload to one topic.
 *
 * `backpressured` maps Bun's `ws.publish()` returning `-1`: at least one peer's
 * outbound buffer is past Bun's drain threshold. It is a Bun-internal signal,
 * not an application-reachable branch: in-process peers read from their
 * sockets, so app code cannot force `-1` (see `ws.send()`/`drain` for the
 * observable backpressure path). It is not a testable manager result; the
 * union keeps it only because Bun can return it.
 */
export interface TopicPublishResult {
  topic: string;
  status: TopicPublishStatus;
}

/** Options for {@link subManager.broadcast} / {@link WssManager.broadcastToTopics}. */
export interface TopicBroadcastOptions {
  /**
   * Also deliver the frame to the publishing socket. Bun's `publish()`
   * excludes the publisher, so this sends one copy through `ws.send()` before
   * fanning out. Defaults to `false` (sender-exclusive, today's behavior).
   * When every target topic rejects the payload as oversize, the sender gets
   * no copy either.
   */
  includeSelf?: boolean;
}

/** One member of a WebSocket topic, as returned by `members()`/presence frames. */
export interface TopicMember {
  /** Connection id assigned by `WSSMAN.register`. */
  id: string;
  /** Registration nickname, falling back to the identity's `nickname` and then `""`. */
  nickname: string;
  /** Identity id from the guard (`contextData.user`/`chatUser`/`principal`). */
  userId?: string;
}

/** Topic presence event names emitted when `WssConfig.presence` is enabled. */
export type TopicPresenceEvent = "join" | "leave";

/**
 * Automatic presence frame: `{ type, topic, member, members }`.
 *
 * `member` is the socket that joined or left; `members` is the topic's member
 * list after the change (the joining socket included on `join`, the departed
 * socket excluded on `leave`).
 */
export interface TopicPresenceFrame {
  type: TopicPresenceEvent;
  topic: string;
  member: TopicMember;
  members: TopicMember[];
}

/** Thrown by `subscribe()` when a topic already has `maxClients` members. */
export class TopicCapacityError extends Error {
  constructor(public readonly topic: string) {
    super("Topic capacity reached");
    this.name = "TopicCapacityError";
  }
}

function normalizeHistoryLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_TOPIC_HISTORY_LIMIT;
  return Number.isSafeInteger(limit) && limit > 0
    ? limit
    : DEFAULT_TOPIC_HISTORY_LIMIT;
}

export class subManager {
  id: string;
  constructor(
    private ws: ServerWebSocket<any>,
    nickname?: string,
  ) {
    this.id = WSSMAN.register(ws, nickname);
  }
  subscribe(topic: string): void {
    WSSMAN.subscribe(this.id, topic);
  }
  unsubscribe(topic: string) {
    WSSMAN.unsubscribe(this.id, topic);
  }
  cleanup() {
    WSSMAN.cleanup(this.id);
  }
  unregister() {
    WSSMAN.unregister(this.id);
  }
  setAdmin(topic: string) {
    WSSMAN.setAdmin(this.id, topic);
  }
  isAdmin(topic: string): boolean {
    return WSSMAN.isAdmin(this.id, topic);
  }
  isSubscribed(topic: string): boolean {
    return WSSMAN.isSubscribed(this.id, topic);
  }
  setTopicConfig(topic: string, config: WssConfig = {}): void {
    WSSMAN.setTopicConfig(topic, config);
  }
  /** Typed member list for a topic; see {@link WssManager.members}. */
  members(topic: string): TopicMember[] {
    return WSSMAN.members(topic);
  }
  /**
   * Publishes to unique topics and returns Bun's outcome for each topic.
   *
   * Pass `{ includeSelf: true }` to also deliver the frame to this socket
   * (Bun's `publish()` otherwise excludes the publisher). The default is
   * sender-exclusive, matching the historical behavior and result shape.
   *
   * `backpressured` is Bun-internal (a peer past the outbound drain threshold)
   * and cannot be produced from application code; see `TopicPublishResult`.
   */
  broadcast(
    topics: string[],
    data: any,
    options?: TopicBroadcastOptions,
  ): TopicPublishResult[] {
    return WSSMAN.broadcastToTopics(this.ws, topics, data, options);
  }
}

export class WssManager {
  private connections = new Map<string, ServerWebSocket<any>>();
  private topicConfigs = new Map<string, WssConfig>();
  private topicRegistry = new Map<string, Set<string>>(); // Map<Topic, Set<ConnectionId>>
  private memberTopics = new Map<string, Set<string>>(); // ID -> Set of Topics
  private roomAdmins = new Map<string, Set<string>>(); // Map<Topic, Set<ConnectionId>>
  /** Last queued history write per topic; replay awaits it before reading. */
  private historySaves = new Map<string, Promise<void>>();

  // This is the "Blueprint" for all random/temp rooms
  private defaultTopicConfig: WssConfig = {
    maxClients: Infinity,
    maxPayloadSize: 65536,
  };

  /** 1. Lifecycle: Register/Unregister Connections */
  register(ws: ServerWebSocket<any>, nickname?: string): string {
    const id = crypto.randomUUID();
    // Save nickname here
    ws.data = { ...ws.data, id, nickname };
    this.connections.set(id, ws);
    return id;
  }

  /**
   * Typed member list for a topic.
   *
   * Returns `{ id, nickname, userId? }` for every live connection subscribed
   * to `topic`, in join order. `nickname` is the registration nickname (or the
   * identity's nickname, or `""`); `userId` is the guard identity's id when it
   * attached one (otherwise the property is absent).
   */
  members(topic: string): TopicMember[] {
    const memberIds = this.topicRegistry.get(topic) || new Set<string>();
    const members: TopicMember[] = [];

    for (const id of memberIds) {
      const member = this.memberDetails(id);
      if (member) members.push(member);
    }
    return members;
  }

  /** @deprecated Use {@link members}; kept for existing call sites. */
  getMemberDetails(topic: string): TopicMember[] {
    return this.members(topic);
  }

  private memberDetails(id: string): TopicMember | undefined {
    const ws = this.connections.get(id);
    if (!ws) return undefined;

    const data = (ws.data ?? {}) as Record<string, any>;
    const identity = resolveSocketIdentity(data.contextData, data) as
      | { id?: unknown; nickname?: unknown }
      | undefined;
    const nickname = String(data.nickname ?? identity?.nickname ?? "");
    const userId =
      typeof identity?.id === "string" ? identity.id : undefined;

    return userId === undefined
      ? { id, nickname }
      : { id, nickname, userId };
  }

  /** Get all topics a specific user is currently in */
  getUserTopics(id: string): string[] {
    return Array.from(this.memberTopics.get(id) || []);
  }

  get(topic: string) {
    return this.members(topic);
  }

  unregister(id: string) {
    this.cleanup(id);
  }

  /** 2. Subscription Management */
  subscribe(id: string, topic: string): void {
    const ws = this.connections.get(id);
    if (!ws) throw new Error("Connection not found");
    if (this.isSubscribed(id, topic)) return;

    const config = this.getConfigForTopic(topic);
    const members = this.topicRegistry.get(topic) ?? new Set<string>();

    if (members.size >= (config.maxClients ?? Infinity)) {
      throw new TopicCapacityError(topic);
    }

    if (!ws.subscribe(topic)) throw new Error("WebSocket is closed");

    this.topicRegistry.set(topic, members);
    members.add(id);
    if (!this.memberTopics.has(id)) this.memberTopics.set(id, new Set());
    this.memberTopics.get(id)!.add(topic);

    const member = this.memberDetails(id);
    if (member) this.emitPresence(id, topic, "join", member);

    this.scheduleHistoryReplay(id, topic, config.history);
  }
  isSubscribed(id: string, topic: string): boolean {
    return this.memberTopics.get(id)?.has(topic) ?? false;
  }

  unsubscribe(id: string, topic: string): void {
    const ws = this.connections.get(id);
    const members = this.topicRegistry.get(topic);
    const wasSubscribed = members?.has(id) ?? false;
    const departingMember = wasSubscribed ? this.memberDetails(id) : undefined;

    if (ws) ws.unsubscribe(topic);

    if (members) {
      members.delete(id);

      // AUTO-CLEANUP: If no users remain, delete the topic key entirely
      if (members.size === 0) {
        this.topicRegistry.delete(topic);
        // Also clean up any admin rights for that empty room
        this.roomAdmins.delete(topic);
      }
    }

    const admins = this.roomAdmins.get(topic);
    admins?.delete(id);
    if (admins?.size === 0) this.roomAdmins.delete(topic);

    // Remove from topic registry
    this.topicRegistry.get(topic)?.delete(id);
    if (this.topicRegistry.get(topic)?.size === 0)
      this.topicRegistry.delete(topic);

    // Remove from reverse lookup
    this.memberTopics.get(id)?.delete(topic);
    if (this.memberTopics.get(id)?.size === 0) this.memberTopics.delete(id);

    if (departingMember) {
      this.emitPresence(id, topic, "leave", departingMember);
    }
  }

  /** 3. Admin & Role Management */
  setAdmin(id: string, topic: string) {
    if (!this.roomAdmins.has(topic)) this.roomAdmins.set(topic, new Set());
    this.roomAdmins.get(topic)!.add(id);
  }

  isAdmin(id: string, topic: string): boolean {
    return this.roomAdmins.get(topic)?.has(id) ?? false;
  }

  /** 4. Security & Config Helpers */
  isPayloadTooLarge(topic: string, byteLength: number): boolean {
    const config = this.getConfigForTopic(topic);
    return byteLength > (config.maxPayloadSize ?? 65536);
  }

  /** True when `topic` already has `maxClients` members. */
  isTopicFull(topic: string): boolean {
    const config = this.getConfigForTopic(topic);
    const members = this.topicRegistry.get(topic)?.size ?? 0;
    return members >= (config.maxClients ?? Infinity);
  }

  /**
   * Returns the first candidate topic that is at capacity, or `null`.
   * Used by the pre-upgrade handshake check.
   */
  findFullTopic(topics: Iterable<string>): string | null {
    for (const topic of new Set(topics)) {
      if (this.isTopicFull(topic)) return topic;
    }
    return null;
  }

  /** Helper to get the correct config for any topic */
  private getConfigForTopic(topic: string): WssConfig {
    if (this.topicConfigs.has(topic)) {
      return this.topicConfigs.get(topic)!;
    }
    // Otherwise, return your default fallback
    return this.defaultTopicConfig;
  }

  setTopicConfig(topic: string, config: WssConfig = {}) {
    // if (this.topicConfigs.has(topic)) return;
    this.topicConfigs.set(topic, config);
  }

  // --- Presence -------------------------------------------------------
  private presenceFor(topic: string): { join: boolean; leave: boolean } {
    const presence = this.getConfigForTopic(topic).presence;
    if (!presence) return { join: false, leave: false };
    if (presence === true) return { join: true, leave: true };
    return {
      join: presence.join !== false,
      leave: presence.leave !== false,
    };
  }

  /**
   * Emits one presence frame when the topic opted in.
   *
   * Delivery works around Bun's sender-exclusive `publish()`: for a join the
   * publishing socket is the new member, so it receives a direct copy after
   * the fan-out. For a leave the publisher is a remaining member, which also
   * needs the direct copy. Without presence config nothing is sent.
   */
  private emitPresence(
    id: string,
    topic: string,
    type: TopicPresenceEvent,
    member: TopicMember,
  ): void {
    if (!this.presenceFor(topic)[type]) return;

    const members = this.members(topic);
    if (type === "leave" && members.length === 0) return;

    const frame: TopicPresenceFrame = { type, topic, member, members };
    const payload = JSON.stringify(frame);

    // Joins publish from the new member; leaves publish from a member that
    // stays behind, so a closed departing socket never has to publish.
    const publisherId = type === "join" ? id : members[0]?.id;
    const publisher = publisherId
      ? this.connections.get(publisherId)
      : undefined;
    if (!publisher) return;

    try {
      publisher.publish(topic, payload);
    } catch {
      return;
    }
    // Bun excludes the publishing socket; give it the frame explicitly.
    try {
      publisher.send(payload);
    } catch {}
  }

  // --- History --------------------------------------------------------
  private scheduleHistoryReplay(
    id: string,
    topic: string,
    history: WssHistoryConfig | undefined,
  ): void {
    if (!history || history.replay === false) return;
    void this.replayHistory(id, topic, history);
  }

  private async replayHistory(
    id: string,
    topic: string,
    history: WssHistoryConfig,
  ): Promise<void> {
    const ws = this.connections.get(id);
    if (!ws) return;

    // Wait for every write queued before this join so a client that joins
    // right after a broadcast still sees it.
    const pending = this.historySaves.get(topic);
    if (pending) await pending;
    if (!this.isSubscribed(id, topic)) return;

    let frames: unknown[];
    try {
      frames = await history.store.recent(
        topic,
        normalizeHistoryLimit(history.limit),
      );
    } catch (error) {
      console.warn("[rossa] topic history replay failed", error);
      return;
    }

    for (const frame of frames) {
      const payload = typeof frame === "string" ? frame : JSON.stringify(frame);
      if (payload === undefined) continue;
      try {
        ws.send(payload);
      } catch {
        return;
      }
    }
  }

  private persistHistoryFrame(topic: string, frame: unknown): void {
    const history = this.getConfigForTopic(topic).history;
    if (!history) return;

    if (history.persist) {
      let shouldPersist = false;
      try {
        shouldPersist = history.persist(frame);
      } catch {
        shouldPersist = false;
      }
      if (!shouldPersist) return;
    }

    const previous = this.historySaves.get(topic) ?? Promise.resolve();
    const next = previous.then(
      () => {
        try {
          return Promise.resolve(history.store.save(topic, frame));
        } catch (error) {
          console.warn("[rossa] topic history save failed", error);
          return undefined;
        }
      },
      () => undefined,
    );
    const settled = next.then(
      () => undefined,
      (error) => {
        console.warn("[rossa] topic history save failed", error);
      },
    );

    this.historySaves.set(topic, settled);
    void settled.then(() => {
      if (this.historySaves.get(topic) === settled)
        this.historySaves.delete(topic);
    });
  }

  // ---  ---------------------------------------------------------------
  /** Broadcast to an array of topics */
  /**
   * Publishes an encoded payload to each unique topic within that topic's
   * configured byte limit.
   *
   * `oversize` is decided before publishing. Bun's `0` is reported as
   * `dropped`, a positive result as `sent`, and `-1` as `backpressured`.
   * `backpressured` is Bun-internal (a peer past the outbound drain threshold);
   * in-process app code cannot force it and no application branch or unit test
   * should depend on it.
   *
   * With `options.includeSelf`, the publishing socket also receives one copy
   * (`ws.send`) before the fan-out, unless every topic rejects the payload as
   * oversize. The returned `TopicPublishResult[]` describes the publish
   * outcomes only and is unchanged by the option.
   *
   * When the topic config has `history`, accepted frames are queued for
   * persistence in `broadcast()` order.
   */
  broadcastToTopics(
    ws: ServerWebSocket<any>,
    topics: string[],
    data: unknown,
    options: TopicBroadcastOptions = {},
  ): TopicPublishResult[] {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    if (payload === undefined) return [];
    const payloadSize = new TextEncoder().encode(payload).byteLength;
    const uniqueTopics = [...new Set(topics)];
    const results: TopicPublishResult[] = [];

    if (options.includeSelf) {
      const deliverable = uniqueTopics.some(
        (topic) => !this.isPayloadTooLarge(topic, payloadSize),
      );
      const readyState = (ws as { readyState?: number }).readyState;
      if (deliverable && (readyState === undefined || readyState === 1)) {
        try {
          ws.send(payload);
        } catch {}
      }
    }

    for (const topic of uniqueTopics) {
      // Security check: ensure we don't broadcast if payload exceeds config
      if (this.isPayloadTooLarge(topic, payloadSize)) {
        results.push({ topic, status: "oversize" });
        continue;
      }

      const result = ws.publish(topic, payload);
      results.push({
        topic,
        status:
          result === 0 ? "dropped" : result === -1 ? "backpressured" : "sent",
      });

      this.persistHistoryFrame(topic, data);
    }

    return results;
  }

  /** Ensures all topics for a client are cleaned up on disconnect */
  cleanup(id: string): void {
    const topics = this.getUserTopics(id);
    for (const topic of topics) {
      this.unsubscribe(id, topic);
    }
    for (const [topic, admins] of this.roomAdmins) {
      admins.delete(id);
      if (admins.size === 0) this.roomAdmins.delete(topic);
    }
    // Remove connection from the registry
    this.connections.delete(id);
  }
}
