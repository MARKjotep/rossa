import { SQL } from "bun";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  DbRepository,
  DbSchema,
  Methods,
  Rossa,
  Websocket,
  route,
  sqliteDialect,
  t,
  wss,
} from "../../src/index";
import type { ctx, wssMessage } from "../../src/index";

const LOBBY_TOPIC = "chat:lobby";
const MAX_LOBBY_MEMBERS = 5;
const MAX_NICKNAME_LENGTH = 24;
const MAX_BODY_LENGTH = 1_000;
const HISTORY_LIMIT = 50;

type GroupChatData = {
  nickname?: string;
  joinSeq?: number;
};

type GroupChatCommand = {
  type?: string;
  nickname?: string;
  to?: string;
  body?: string;
};

interface ChatMessageRow {
  id: number;
  nickname: string;
  body: string;
  createdAt: string;
}

/** Wire shape used by both live `message` frames and `history` entries. */
interface ChatMessage {
  id: number;
  from: string;
  body: string;
  createdAt: string;
}

const dataDir = join(import.meta.dir, "data");
mkdirSync(dataDir, { recursive: true });

const db = new SQL(`sqlite://${join(dataDir, "chat.sqlite")}`, { max: 1 });
const chatMessages = new DbRepository(
  db,
  new DbSchema<ChatMessageRow>(
    "chat_messages",
    {
      id: t.serial().primary,
      nickname: t.text().notNull,
      body: t.text().notNull,
      createdAt: t.text().notNull,
    },
    sqliteDialect,
  ),
);
await chatMessages.create();

/** Active members keyed by nickname, valued by join sequence (older is lower). */
const members = new Map<string, number>();
let nextJoinSeq = 1;
let admin: string | null = null;

function toWireMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    from: row.nickname,
    body: row.body,
    createdAt: row.createdAt,
  };
}

/** Returns the latest 50 messages in chronological order. */
async function recentHistory(): Promise<ChatMessage[]> {
  const rows = await chatMessages.findAll();
  return rows
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
    .slice(0, HISTORY_LIMIT)
    .reverse()
    .map(toWireMessage);
}

function oldestMember(): string | null {
  let oldest: string | null = null;
  let oldestSeq = Number.POSITIVE_INFINITY;

  for (const [nickname, joinSeq] of members) {
    if (joinSeq < oldestSeq) {
      oldestSeq = joinSeq;
      oldest = nickname;
    }
  }

  return oldest;
}

function presencePayload() {
  const online = [...members.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([nickname]) => nickname);

  return { type: "presence", online, admin };
}

/** Each member owns one inbox topic for live 1v1 messages. */
function personalTopic(nickname: string): string {
  return `dm:${nickname}`;
}

/**
 * Nickname-only lobby chat. The first member to join is the admin, the lobby is
 * capped at five members, and admin ownership moves to the longest-connected
 * member when the admin disconnects.
 */
@wss("/ws")
class GroupChatSocket extends Websocket<GroupChatData> {
  override open() {
    // Apply the cap before the first subscribe. The manager throws when a sixth
    // member tries to subscribe, which `join` turns into `room_full`.
    this.manager.setTopicConfig(LOBBY_TOPIC, {
      maxClients: MAX_LOBBY_MEMBERS,
    });
  }

  override async message({ json }: wssMessage<GroupChatCommand>) {
    if (json.type === "join") {
      await this.join(json.nickname);
      return;
    }

    if (json.type === "send") {
      await this.sendMessage(json.body);
      return;
    }

    if (json.type === "dm") {
      this.directMessage(json.to, json.body);
      return;
    }

    this.fail(json.type === undefined ? "invalid_message" : "unknown_type");
  }

  override close() {
    const nickname = this.data.nickname;
    if (nickname === undefined) return;

    delete this.data.nickname;
    delete this.data.joinSeq;
    members.delete(nickname);

    // Longest-connected surviving member inherits admin when the admin leaves.
    // With an empty lobby this becomes null, so the next joiner becomes admin.
    if (admin === nickname) admin = oldestMember();

    this.manager.broadcast([LOBBY_TOPIC], presencePayload());
  }

  private async join(rawNickname: unknown) {
    if (this.data.nickname !== undefined) {
      this.fail("already_joined");
      return;
    }

    if (typeof rawNickname !== "string") {
      this.fail("invalid_nickname");
      return;
    }

    const nickname = rawNickname.trim();
    if (nickname.length === 0 || nickname.length > MAX_NICKNAME_LENGTH) {
      this.fail("invalid_nickname");
      return;
    }

    if (members.has(nickname)) {
      this.fail("nickname_taken");
      return;
    }

    try {
      this.manager.subscribe(LOBBY_TOPIC);
    } catch {
      // The topic is already at `maxClients`; do not add the nickname.
      this.fail("room_full");
      return;
    }

    // The inbox topic is separate from the capped lobby, so live DMs do not
    // consume lobby slots.
    this.manager.subscribe(personalTopic(nickname));

    const joinSeq = nextJoinSeq++;
    members.set(nickname, joinSeq);
    this.data.nickname = nickname;
    this.data.joinSeq = joinSeq;

    if (admin === null || !members.has(admin)) admin = nickname;

    this.send = JSON.stringify({
      type: "joined",
      nickname,
      admin: admin === nickname,
    });

    const presence = presencePayload();
    // Bun's publish does not echo to the publishing socket, so also send the
    // new member its own presence snapshot.
    this.manager.broadcast([LOBBY_TOPIC], presence);
    this.send = JSON.stringify(presence);

    try {
      const messages = await recentHistory();
      this.send = JSON.stringify({ type: "history", messages });
    } catch {
      this.fail("persistence_failed");
    }
  }

  private async sendMessage(rawBody: unknown) {
    const nickname = this.data.nickname;
    if (nickname === undefined) {
      this.fail("join_required");
      return;
    }

    if (typeof rawBody !== "string" || rawBody.trim().length === 0) {
      this.fail("invalid_message");
      return;
    }

    if (rawBody.length > MAX_BODY_LENGTH) {
      this.fail("message_too_long");
      return;
    }

    let row: ChatMessageRow | undefined;
    try {
      row = await chatMessages.insert({
        nickname,
        body: rawBody,
        createdAt: new Date().toISOString(),
      } as ChatMessageRow);
    } catch {
      this.fail("persistence_failed");
      return;
    }

    if (!row) {
      this.fail("persistence_failed");
      return;
    }

    // Persist first, then publish. The sender also gets its own copy because
    // Bun's publish does not echo to the publishing socket.
    const message: ChatMessage = {
      id: row.id,
      from: row.nickname,
      body: row.body,
      createdAt: row.createdAt,
    };
    const frame = { type: "message", ...message };

    this.manager.broadcast([LOBBY_TOPIC], frame);
    this.send = JSON.stringify(frame);
    this.send = JSON.stringify({ type: "sent", id: row.id });
  }

  private directMessage(rawTo: unknown, rawBody: unknown) {
    const nickname = this.data.nickname;
    if (nickname === undefined) {
      this.fail("join_required");
      return;
    }

    if (typeof rawTo !== "string" || rawTo.trim().length === 0) {
      this.fail("invalid_recipient");
      return;
    }

    const to = rawTo.trim();
    if (to === nickname) {
      this.fail("self_dm");
      return;
    }

    if (typeof rawBody !== "string" || rawBody.trim().length === 0) {
      this.fail("invalid_message");
      return;
    }

    if (rawBody.length > MAX_BODY_LENGTH) {
      this.fail("message_too_long");
      return;
    }

    // Live-only routing: the recipient must be a current lobby member. No row
    // is written and no history is exposed; the persistent 1v1 example owns
    // that behavior.
    if (!members.has(to)) {
      this.fail("user_offline");
      return;
    }

    this.manager.broadcast([personalTopic(to)], {
      type: "dm",
      from: nickname,
      body: rawBody,
    });
    this.send = JSON.stringify({ type: "dm_sent", to });
  }

  private fail(code: string) {
    this.send = JSON.stringify({ type: "error", code });
  }
}

const INDEX_FILE = Bun.file(join(import.meta.dir, "index.html"));

/** Serves the self-contained chat page from the same server as the socket. */
@route("/")
class GroupChatPage extends Methods {
  get({ res }: ctx): Promise<Response> {
    return res.file(INDEX_FILE);
  }
}

export const app = new Rossa({ Encoding: "none" });
app.register(GroupChatPage);
app.registerWSS(GroupChatSocket);

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8787);
  const server = app.serve({ port });
  console.log(`Group chat listening on http://localhost:${server.port}`);
}
