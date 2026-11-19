import { WSSMAN, type WssConfig } from "./config.wss";
import type { ServerWebSocket } from "bun";

export type TopicPublishStatus =
  "sent" | "backpressured" | "dropped" | "oversize";

export interface TopicPublishResult {
  topic: string;
  status: TopicPublishStatus;
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
  /** Publishes to unique topics and returns Bun's outcome for each topic. */
  broadcast(topics: string[], data: any): TopicPublishResult[] {
    return WSSMAN.broadcastToTopics(this.ws, topics, data);
  }
}

export class WssManager {
  private connections = new Map<string, ServerWebSocket<any>>();
  private topicConfigs = new Map<string, WssConfig>();
  private topicRegistry = new Map<string, Set<string>>(); // Map<Topic, Set<ConnectionId>>
  private memberTopics = new Map<string, Set<string>>(); // ID -> Set of Topics
  private roomAdmins = new Map<string, Set<string>>(); // Map<Topic, Set<ConnectionId>>

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

  getMemberDetails(topic: string) {
    const memberIds = this.topicRegistry.get(topic) || new Set();
    const members = [];

    for (const id of memberIds) {
      const ws = this.connections.get(id);
      if (ws) {
        members.push({
          id,
          userId: ws.data.contextData?.chatUser?.id,
          nickname: ws.data.nickname,
        });
      }
    }
    return members;
  }

  /** Get all topics a specific user is currently in */
  getUserTopics(id: string): string[] {
    return Array.from(this.memberTopics.get(id) || []);
  }

  get(topic: string) {
    return this.getMemberDetails(topic);
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
      throw new Error("Topic capacity reached");
    }

    if (!ws.subscribe(topic)) throw new Error("WebSocket is closed");

    this.topicRegistry.set(topic, members);
    members.add(id);
    if (!this.memberTopics.has(id)) this.memberTopics.set(id, new Set());
    this.memberTopics.get(id)!.add(topic);
  }
  isSubscribed(id: string, topic: string): boolean {
    return this.memberTopics.get(id)?.has(topic) ?? false;
  }

  unsubscribe(id: string, topic: string): void {
    const ws = this.connections.get(id);
    if (ws) ws.unsubscribe(topic);

    const members = this.topicRegistry.get(topic);
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

  // ---  ---------------------------------------------------------------
  /** Broadcast to an array of topics */
  /**
   * Publishes an encoded payload to each unique topic within that topic's
   * configured byte limit. Bun's `-1` result is reported as backpressured,
   * `0` as dropped, and a positive result as sent.
   */
  broadcastToTopics(
    ws: ServerWebSocket<any>,
    topics: string[],
    data: unknown,
  ): TopicPublishResult[] {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    if (payload === undefined) return [];
    const payloadSize = new TextEncoder().encode(payload).byteLength;
    const results: TopicPublishResult[] = [];

    for (const topic of new Set(topics)) {
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
