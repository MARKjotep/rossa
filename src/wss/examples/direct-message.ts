import { createGuard } from "../../guard/@/base.guard";
import { use } from "../../guard/@/@.guard";
import { wss } from "../../router/@";
import type { wssMessage } from "../config.wss";
import { Websocket } from "../websocket.wss";
import type { ChatRecord, ChatUser, GroupChatStore } from "./group-chat";

/**
 * Extend the group chat adapter with an atomic find-or-create operation for
 * the private conversation shared by two users.
 */
export interface DirectMessageStore extends GroupChatStore {
  findOrCreateDirectConversation(
    currentUserId: string,
    otherUserId: string,
  ): Promise<string | null>;
}

type DirectMessageData = {
  joinedConversationIds: Set<string>;
};

type DirectMessageCommand = Record<string, any> & {
  type?: string;
  recipientId?: string;
  conversationId?: string;
  body?: string;
};

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_ROOM_CONNECTIONS = 8;
const MAX_PUBLISHED_BYTES = 16 * 1024;

export interface DirectMessageLimits {
  maxMessageLength: number;
  maxRoomConnections: number;
  maxPublishedBytes: number;
}

/**
 * Creates a session-authenticated one-to-one DM controller. The server owns
 * the private conversation topic and relays persisted messages to its members.
 */
export function createDirectMessageController(
  store: DirectMessageStore,
  limits: Partial<DirectMessageLimits> = {},
): new () => Websocket<DirectMessageData> {
  const resolvedLimits: DirectMessageLimits = {
    maxMessageLength: limits.maxMessageLength ?? MAX_MESSAGE_LENGTH,
    maxRoomConnections: limits.maxRoomConnections ?? MAX_ROOM_CONNECTIONS,
    maxPublishedBytes: limits.maxPublishedBytes ?? MAX_PUBLISHED_BYTES,
  };

  const authenticate = createGuard<void>(async (ctx, next) => {
    const sessionId = ctx.req.cookies.get("session");
    const user = await store.userFromSession(sessionId);
    if (!user) return ctx.res.error(401, "Unauthorized");

    ctx.data.chatUser = {
      id: user.id,
      ...(user.nickname === undefined ? {} : { nickname: user.nickname }),
    } satisfies ChatUser;
    return await next();
  })();

  @wss("/examples/direct-message")
  @use(authenticate)
  class DirectMessageSocket extends Websocket<DirectMessageData> {
    override open() {
      this.data.joinedConversationIds = new Set();
    }

    override async message({ json }: wssMessage<DirectMessageCommand>) {
      const currentUserId = this.contextData.chatUser?.id as string | undefined;
      if (!currentUserId) {
        this.send = JSON.stringify({ type: "error", code: "unauthorized" });
        return;
      }

      if (json.type === "start") {
        await this.startConversation(currentUserId, json.recipientId);
        return;
      }

      if (json.type === "send") {
        await this.sendMessage(currentUserId, json.conversationId, json.body);
        return;
      }

      this.send = JSON.stringify({ type: "error", code: "unknown_type" });
    }

    private async startConversation(
      currentUserId: string,
      recipientId: unknown,
    ) {
      if (
        typeof recipientId !== "string" ||
        !recipientId.trim() ||
        recipientId === currentUserId
      ) {
        this.send = JSON.stringify({
          type: "error",
          code: "invalid_recipient",
        });
        return;
      }

      let conversationId: string | null;
      try {
        // The adapter checks recipient validity/DM policy and atomically finds
        // or creates the conversation with both users as members.
        conversationId = await store.findOrCreateDirectConversation(
          currentUserId,
          recipientId,
        );
      } catch {
        this.send = JSON.stringify({
          type: "error",
          code: "conversation_unavailable",
        });
        return;
      }

      if (!conversationId) {
        this.send = JSON.stringify({
          type: "error",
          code: "conversation_unavailable",
        });
        return;
      }

      if (!(await store.isConversationMember(currentUserId, conversationId))) {
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
        this.send = JSON.stringify({
          type: "error",
          code: "conversation_full",
        });
        return;
      }

      this.data.joinedConversationIds.add(conversationId);
      this.send = JSON.stringify({ type: "ready", conversationId });
    }

    private async sendMessage(
      currentUserId: string,
      conversationId: unknown,
      body: unknown,
    ) {
      if (
        typeof conversationId !== "string" ||
        !this.data.joinedConversationIds.has(conversationId)
      ) {
        this.send = JSON.stringify({ type: "error", code: "start_required" });
        return;
      }
      if (typeof body !== "string" || !body.trim()) {
        this.send = JSON.stringify({ type: "error", code: "invalid_message" });
        return;
      }
      if (body.length > resolvedLimits.maxMessageLength) {
        this.send = JSON.stringify({ type: "error", code: "message_too_long" });
        return;
      }

      if (!(await store.isConversationMember(currentUserId, conversationId))) {
        this.manager.unsubscribe(conversationTopic(conversationId));
        this.data.joinedConversationIds.delete(conversationId);
        this.send = JSON.stringify({ type: "error", code: "forbidden" });
        return;
      }

      let record: ChatRecord;
      try {
        record = await store.createMessage({
          conversationId,
          senderId: currentUserId,
          body,
        });
      } catch {
        this.send = JSON.stringify({
          type: "error",
          code: "persistence_failed",
        });
        return;
      }

      this.manager.broadcast([conversationTopic(conversationId)], {
        type: "message",
        message: record,
      });
      this.send = JSON.stringify({ type: "sent", messageId: record.id });
    }
  }

  return DirectMessageSocket;
}

function conversationTopic(conversationId: string): string {
  return `chat:direct:${conversationId}`;
}
