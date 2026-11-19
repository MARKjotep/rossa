import { afterEach, describe, expect, it } from "bun:test";
import { Rossa } from "../../src/index";
import {
  createGroupChatController,
  type ChatRecord,
  type ChatUser,
  type GroupChatLimits,
  type GroupChatStore,
} from "../../src/wss/examples/group-chat";
import { getFreePort } from "../helpers";

class MemoryChatStore implements GroupChatStore {
  users = new Map<string, ChatUser>();
  members = new Map<string, Set<string>>();
  messages: ChatRecord[] = [];
  failPersistence = false;

  async userFromSession(sessionId: string | undefined) {
    return sessionId ? (this.users.get(sessionId) ?? null) : null;
  }

  async isConversationMember(userId: string, conversationId: string) {
    return this.members.get(conversationId)?.has(userId) ?? false;
  }

  async createMessage(input: Omit<ChatRecord, "id" | "createdAt">) {
    if (this.failPersistence) throw new Error("database is unavailable");
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

async function startChatServer(
  store: GroupChatStore,
  limits: Partial<GroupChatLimits> = {},
) {
  const app = new Rossa({ Encoding: "none" });
  app.registerWSS(createGroupChatController(store, limits));
  const server = app.serve({ hostname: "127.0.0.1", port: await getFreePort() });
  servers.push(server);
  return server;
}

async function connect(port: number, session: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/chat`, {
    headers: { Cookie: `session=${session}` },
  } as any);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error("Timed out opening chat socket")), 2_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeoutId);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeoutId);
      reject(new Error("Chat WebSocket handshake failed"));
    }, { once: true });
  });
  return socket;
}

function nextJson(socket: WebSocket): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error("Timed out waiting for chat event")), 2_000);
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

async function sendAndRead(socket: WebSocket, command: Record<string, unknown>) {
  const response = nextJson(socket);
  socket.send(JSON.stringify(command));
  return await response;
}

function watchForMessage(socket: WebSocket, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const listener = () => {
      clearTimeout(timeoutId);
      resolve(true);
    };
    const timeoutId = setTimeout(() => {
      socket.removeEventListener("message", listener);
      resolve(false);
    }, timeoutMs);
    socket.addEventListener("message", listener, { once: true });
  });
}

describe("group chat controller integration", () => {
  it("checks membership on join and again before sending", async () => {
    const store = new MemoryChatStore();
    store.users.set("alice-session", { id: "alice" });
    store.users.set("bob-session", { id: "bob" });
    const conversationId = `dm-${crypto.randomUUID()}`;
    store.members.set(conversationId, new Set(["alice"]));
    const server = await startChatServer(store);

    const alice = await connect(server.port!, "alice-session");
    await expect(sendAndRead(alice, { type: "join", conversationId })).resolves.toEqual({
      type: "joined",
      conversationId,
    });

    const bob = await connect(server.port!, "bob-session");
    await expect(sendAndRead(bob, { type: "join", conversationId })).resolves.toEqual({
      type: "error",
      code: "forbidden",
    });

    store.members.get(conversationId)!.delete("alice");
    await expect(sendAndRead(alice, {
      type: "send",
      conversationId,
      body: "membership was revoked",
    })).resolves.toEqual({ type: "error", code: "forbidden" });
    expect(store.messages).toHaveLength(0);
  });

  it("enforces configured room capacity through the chat command flow", async () => {
    const store = new MemoryChatStore();
    store.users.set("alice-session", { id: "alice" });
    store.users.set("bob-session", { id: "bob" });
    const conversationId = `group-${crypto.randomUUID()}`;
    store.members.set(conversationId, new Set(["alice", "bob"]));
    const server = await startChatServer(store, { maxRoomConnections: 1 });

    const alice = await connect(server.port!, "alice-session");
    await expect(sendAndRead(alice, { type: "join", conversationId })).resolves.toEqual({
      type: "joined",
      conversationId,
    });

    const bob = await connect(server.port!, "bob-session");
    await expect(sendAndRead(bob, { type: "join", conversationId })).resolves.toEqual({
      type: "error",
      code: "room_full",
    });
  });

  it("reports persistence failure without publishing an unpersisted message", async () => {
    const store = new MemoryChatStore();
    store.users.set("alice-session", { id: "alice" });
    store.users.set("bob-session", { id: "bob" });
    const conversationId = `group-${crypto.randomUUID()}`;
    store.members.set(conversationId, new Set(["alice", "bob"]));
    const server = await startChatServer(store);

    const alice = await connect(server.port!, "alice-session");
    const bob = await connect(server.port!, "bob-session");
    await sendAndRead(alice, { type: "join", conversationId });
    await sendAndRead(bob, { type: "join", conversationId });
    store.failPersistence = true;

    const noPrematureBroadcast = watchForMessage(bob, 100);
    await expect(sendAndRead(alice, {
      type: "send",
      conversationId,
      body: "must not be published",
    })).resolves.toEqual({ type: "error", code: "persistence_failed" });

    expect(await noPrematureBroadcast).toBe(false);
    expect(store.messages).toHaveLength(0);
  });
});
