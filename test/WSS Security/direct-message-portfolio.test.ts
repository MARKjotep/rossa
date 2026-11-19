import { afterEach, describe, expect, it } from "bun:test";
import { Rossa } from "../../src/index";
import type { ChatRecord, ChatUser } from "../../src/wss/examples/group-chat";
import {
  createDirectMessageController,
  type DirectMessageStore,
} from "../../src/wss/examples/direct-message";
import { PortfolioChatSocket } from "../../src/wss/examples/portfolio-chat";
import { getFreePort } from "../helpers";

class MemoryDirectMessageStore implements DirectMessageStore {
  users = new Map<string, ChatUser>();
  members = new Map<string, Set<string>>();
  messages: ChatRecord[] = [];
  conversations = new Map<string, string>();

  async userFromSession(sessionId: string | undefined) {
    return sessionId ? (this.users.get(sessionId) ?? null) : null;
  }

  async isConversationMember(userId: string, conversationId: string) {
    return this.members.get(conversationId)?.has(userId) ?? false;
  }

  async findOrCreateDirectConversation(currentUserId: string, otherUserId: string) {
    if (!this.users.has(`${currentUserId}-session`) || !this.users.has(`${otherUserId}-session`)) {
      return null;
    }

    const pair = [currentUserId, otherUserId].sort().join(":");
    let conversationId = this.conversations.get(pair);
    if (!conversationId) {
      conversationId = `dm-${crypto.randomUUID()}`;
      this.conversations.set(pair, conversationId);
      this.members.set(conversationId, new Set([currentUserId, otherUserId]));
    }
    return conversationId;
  }

  async createMessage(input: Omit<ChatRecord, "id" | "createdAt">) {
    const record: ChatRecord = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.messages.push(record);
    return record;
  }
}

const servers: Array<{ stop: (closeActiveConnections?: boolean) => unknown }> = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
  sockets.length = 0;
  for (const server of servers) await server.stop(true);
  servers.length = 0;
});

async function startServer(register: (app: Rossa) => void) {
  const app = new Rossa({ Encoding: "none" });
  register(app);
  const server = app.serve({ hostname: "127.0.0.1", port: await getFreePort() });
  servers.push(server);
  return server;
}

function createSocket(port: number, path: string, session?: string) {
  const url = `ws://127.0.0.1:${port}${path}`;
  const socket = session
    ? new WebSocket(url, { headers: { Cookie: `session=${session}` } } as any)
    : new WebSocket(url);
  sockets.push(socket);
  return socket;
}

async function waitForOpen(socket: WebSocket) {
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error("Timed out opening WebSocket")), 2_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeoutId);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeoutId);
      reject(new Error("WebSocket handshake failed"));
    }, { once: true });
  });
}

function nextJson(socket: WebSocket): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error("Timed out waiting for WebSocket JSON")), 2_000);
    socket.addEventListener("message", (event) => {
      clearTimeout(timeoutId);
      try {
        resolve(JSON.parse(String(event.data)));
      } catch (error) {
        reject(error);
      }
    }, { once: true });
  });
}

function nextJsonOfType(socket: WebSocket, type: string): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`Timed out waiting for WebSocket ${type} event`));
    }, 2_000);
    const onMessage = (event: MessageEvent) => {
      let value: Record<string, any>;
      try {
        value = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (value.type !== type) return;
      clearTimeout(timeoutId);
      socket.removeEventListener("message", onMessage);
      resolve(value);
    };
    socket.addEventListener("message", onMessage);
  });
}

async function sendAndRead(socket: WebSocket, value: Record<string, unknown>) {
  const response = nextJson(socket);
  socket.send(JSON.stringify(value));
  return await response;
}

describe("direct message WebSocket example", () => {
  it("creates the same private conversation for both users and delivers persisted messages", async () => {
    const store = new MemoryDirectMessageStore();
    store.users.set("alice-session", { id: "alice" });
    store.users.set("bob-session", { id: "bob" });
    const server = await startServer((app) => {
      app.registerWSS(createDirectMessageController(store));
    });

    const alice = createSocket(server.port!, "/examples/direct-message", "alice-session");
    await waitForOpen(alice);
    const aliceStarted = await sendAndRead(alice, {
      type: "start",
      recipientId: "bob",
    });
    expect(aliceStarted.type).toBe("ready");

    const bob = createSocket(server.port!, "/examples/direct-message", "bob-session");
    await waitForOpen(bob);
    const bobStarted = await sendAndRead(bob, {
      type: "start",
      recipientId: "alice",
    });
    expect(bobStarted).toEqual(aliceStarted);

    const conversationId = String(aliceStarted.conversationId);
    const bobMessage = nextJson(bob);
    const aliceAck = sendAndRead(alice, {
      type: "send",
      conversationId,
      body: "Hello Bob",
    });

    await expect(aliceAck).resolves.toEqual({
      type: "sent",
      messageId: expect.any(String),
    });
    const delivered = await bobMessage;
    expect(delivered.type).toBe("message");
    expect(delivered.message).toMatchObject({
      conversationId,
      senderId: "alice",
      body: "Hello Bob",
    });
    expect(store.messages).toHaveLength(1);
    expect(delivered.message.id).toBe(store.messages[0]!.id);
  });
});

describe("portfolio chat WebSocket example", () => {
  it("responds to portfolio questions and rejects empty messages", async () => {
    const server = await startServer((app) => {
      app.registerWSS(PortfolioChatSocket);
    });

    const socket = createSocket(server.port!, "/examples/portfolio-chat");
    await waitForOpen(socket);

    const projectReply = nextJsonOfType(socket, "reply");
    socket.send(JSON.stringify({
      type: "message",
      message: "Can I see a project?",
    }));
    await expect(projectReply).resolves.toEqual({
      type: "reply",
      message: "You can browse the projects section to see selected work and case studies.",
    });

    const validationError = nextJsonOfType(socket, "error");
    socket.send(JSON.stringify({
      type: "message",
      message: "   ",
    }));
    await expect(validationError).resolves.toEqual({ type: "error", code: "empty_message" });
  });
});
