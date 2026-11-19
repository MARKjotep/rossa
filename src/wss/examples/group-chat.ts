import { createGuard } from "../../guard/@/base.guard";
import { use } from "../../guard/@/@.guard";
import { wss } from "../../router/@";
import type { wssMessage } from "../config.wss";
import { Websocket } from "../websocket.wss";

export interface ChatUser {
  id: string;
  nickname?: string;
}

export interface ChatRecord {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

/** Implement these methods with your session service and persistent database. */
export interface GroupChatStore {
  userFromSession(sessionId: string | undefined): Promise<ChatUser | null>;
  isConversationMember(
    userId: string,
    conversationId: string,
  ): Promise<boolean>;
  createMessage(input: {
    conversationId: string;
    senderId: string;
    body: string;
  }): Promise<ChatRecord>;
}

type ChatSocketData = {
  joinedConversationIds: Set<string>;
};

type ChatCommand = Record<string, any> & {
  type?: string;
  conversationId?: string;
  body?: string;
};

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_ROOM_CONNECTIONS = 250;
const MAX_PUBLISHED_BYTES = 16 * 1024;

export interface GroupChatLimits {
  maxMessageLength: number;
  maxRoomConnections: number;
  maxPublishedBytes: number;
}

/**
 * Creates a WebSocket controller for group conversations.
 *
 * WebSocket authentication uses the existing `session` cookie. The store is
 * responsible for resolving that session and checking persistent membership.
 */
export function createGroupChatController(
  store: GroupChatStore,
  limits: Partial<GroupChatLimits> = {},
) {
  const resolvedLimits: GroupChatLimits = {
    maxMessageLength: limits.maxMessageLength ?? MAX_MESSAGE_LENGTH,
    maxRoomConnections: limits.maxRoomConnections ?? MAX_ROOM_CONNECTIONS,
    maxPublishedBytes: limits.maxPublishedBytes ?? MAX_PUBLISHED_BYTES,
  };

  const authenticate = createGuard<void>(async (ctx, next) => {
    const sessionId = ctx.req.cookies.get("session");
    const user = await store.userFromSession(sessionId);

    if (!user) return ctx.res.error(401, "Unauthorized");

    // Rossa copies this guard data onto the Websocket instance before upgrade.
    ctx.data.chatUser = {
      id: user.id,
      ...(user.nickname === undefined ? {} : { nickname: user.nickname }),
    } satisfies ChatUser;
    return await next();
  })();

  @wss("/chat")
  @use(authenticate)
  class GroupChatSocket extends Websocket<ChatSocketData> {
    override open() {
      this.data.joinedConversationIds = new Set();
    }

    override async message({ json }: wssMessage<ChatCommand>) {
      const userId = this.contextData.chatUser?.id as string | undefined;
      if (!userId) {
        this.send = JSON.stringify({ type: "error", code: "unauthorized" });
        return;
      }

      const { type, conversationId, body } = json;
      if (typeof type !== "string") {
        this.send = JSON.stringify({ type: "error", code: "invalid_message" });
        return;
      }

      if (type === "join") {
        if (typeof conversationId !== "string" || !conversationId.trim()) {
          this.send = JSON.stringify({ type: "error", code: "missing_room" });
          return;
        }

        if (!(await store.isConversationMember(userId, conversationId))) {
          this.send = JSON.stringify({ type: "error", code: "forbidden" });
          return;
        }

        const topic = conversationTopic(conversationId);
        this.manager.setTopicConfig(topic, {
          maxClients: resolvedLimits.maxRoomConnections,
          maxPayloadSize: resolvedLimits.maxPublishedBytes,
        });

        try {
          this.manager.subscribe(topic);
        } catch {
          this.send = JSON.stringify({ type: "error", code: "room_full" });
          return;
        }

        this.data.joinedConversationIds.add(conversationId);
        this.send = JSON.stringify({ type: "joined", conversationId });
        return;
      }

      if (type === "send") {
        if (
          typeof conversationId !== "string" ||
          !conversationId.trim() ||
          typeof body !== "string" ||
          !body.trim()
        ) {
          this.send = JSON.stringify({
            type: "error",
            code: "invalid_message",
          });
          return;
        }

        if (!this.data.joinedConversationIds.has(conversationId)) {
          this.send = JSON.stringify({ type: "error", code: "join_required" });
          return;
        }

        if (body.length > resolvedLimits.maxMessageLength) {
          this.send = JSON.stringify({
            type: "error",
            code: "message_too_long",
          });
          return;
        }

        // Re-check persistent membership for every send. A connection may
        // remain open after a user has been removed from the conversation.
        if (!(await store.isConversationMember(userId, conversationId))) {
          this.manager.unsubscribe(conversationTopic(conversationId));
          this.data.joinedConversationIds.delete(conversationId);
          this.send = JSON.stringify({ type: "error", code: "forbidden" });
          return;
        }

        let record: ChatRecord;
        try {
          record = await store.createMessage({
            conversationId,
            senderId: userId,
            body,
          });
        } catch {
          this.send = JSON.stringify({
            type: "error",
            code: "persistence_failed",
          });
          return;
        }

        // Persist first, then publish to all currently connected members.
        this.manager.broadcast([conversationTopic(conversationId)], {
          type: "message",
          message: record,
        });

        // Bun's publish does not echo to the publishing socket by default.
        this.send = JSON.stringify({ type: "sent", messageId: record.id });
        return;
      }

      this.send = JSON.stringify({ type: "error", code: "unknown_type" });
    }
  }

  return GroupChatSocket;
}

function conversationTopic(conversationId: string): string {
  return `chat:conversation:${conversationId}`;
}
