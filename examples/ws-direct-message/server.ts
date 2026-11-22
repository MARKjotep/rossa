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

const LOBBY_TOPIC = "lobby:dm-presence";
const MAX_NICKNAME_LENGTH = 24;
const MAX_BODY_LENGTH = 1_000;

type DirectMessageData = {
  nickname?: string;
};

type DirectMessageCommand = {
  type?: string;
  nickname?: string;
  to?: string;
  body?: string;
  with?: string;
};

interface DmMessageRow {
  id: number;
  fromNickname: string;
  toNickname: string;
  body: string;
  createdAt: string;
}

const dataDir = join(import.meta.dir, "data");
mkdirSync(dataDir, { recursive: true });

const db = new SQL(`sqlite://${join(dataDir, "chat.sqlite")}`, { max: 1 });
const dmMessages = new DbRepository(
  db,
  new DbSchema<DmMessageRow>(
    "dm_messages",
    {
      id: t.serial().primary,
      fromNickname: t.text().notNull,
      toNickname: t.text().notNull,
      body: t.text().notNull,
      createdAt: t.text().notNull,
    },
    sqliteDialect,
  ),
);
await dmMessages.create();

/** Online members keyed by nickname, valued by join sequence. */
const members = new Map<string, number>();
/** Nicknames seen in this process; lets us save DMs to offline members. */
const knownNicknames = new Set<string>();
let nextJoinSeq = 1;

function presencePayload() {
  const online = [...members.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([nickname]) => nickname);

  return { type: "presence", online };
}

function personalTopic(nickname: string): string {
  return `dm:${nickname}`;
}

/**
 * Nickname-only direct messaging. DMs are persisted before delivery; online
 * recipients get a live `dm` frame, offline known recipients get
 * `delivered: false`, and unknown nicknames are rejected.
 */
@wss("/ws")
class DirectMessageSocket extends Websocket<DirectMessageData> {
  override async message({ json }: wssMessage<DirectMessageCommand>) {
    if (json.type === "join") {
      this.join(json.nickname);
      return;
    }

    if (json.type === "dm") {
      await this.directMessage(json.to, json.body);
      return;
    }

    if (json.type === "history") {
      await this.history(json.with);
      return;
    }

    this.fail(json.type === undefined ? "invalid_message" : "unknown_type");
  }

  override close() {
    const nickname = this.data.nickname;
    if (nickname === undefined) return;

    delete this.data.nickname;
    members.delete(nickname);
    // `knownNicknames` intentionally keeps the nickname so DMs to this member
    // are still accepted (and saved with `delivered: false`) while offline.
    this.manager.broadcast([LOBBY_TOPIC], presencePayload());
  }

  private join(rawNickname: unknown) {
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

    this.manager.subscribe(LOBBY_TOPIC);
    // Every member owns one inbox topic, so DMs can be delivered without
    // joining a per-conversation topic.
    this.manager.subscribe(personalTopic(nickname));

    members.set(nickname, nextJoinSeq++);
    knownNicknames.add(nickname);
    this.data.nickname = nickname;

    this.send = JSON.stringify({ type: "joined", nickname });

    const presence = presencePayload();
    // Bun's publish does not echo to the publishing socket; send the new
    // member its own roster snapshot too.
    this.manager.broadcast([LOBBY_TOPIC], presence);
    this.send = JSON.stringify(presence);
  }

  private async directMessage(rawTo: unknown, rawBody: unknown) {
    const from = this.data.nickname;
    if (from === undefined) {
      this.fail("join_required");
      return;
    }

    if (typeof rawTo !== "string" || rawTo.trim().length === 0) {
      this.fail("invalid_recipient");
      return;
    }

    const to = rawTo.trim();
    if (to === from) {
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

    // Unknown nicknames are errors. Known-but-offline nicknames are accepted
    // and saved; the ack's `delivered` flag tells the sender what happened.
    if (!members.has(to) && !knownNicknames.has(to)) {
      this.fail("user_offline");
      return;
    }

    let row: DmMessageRow | undefined;
    try {
      row = await dmMessages.insert({
        fromNickname: from,
        toNickname: to,
        body: rawBody,
        createdAt: new Date().toISOString(),
      } as DmMessageRow);
    } catch {
      this.fail("persistence_failed");
      return;
    }

    if (!row) {
      this.fail("persistence_failed");
      return;
    }

    // Re-check after the database write: the recipient may have left while the
    // message was being saved.
    const delivered = members.has(to);
    if (delivered) {
      this.manager.broadcast([personalTopic(to)], {
        type: "dm",
        id: row.id,
        from,
        body: rawBody,
      });
    }

    this.send = JSON.stringify({ type: "sent", to, delivered });
  }

  private async history(rawWith: unknown) {
    const me = this.data.nickname;
    if (me === undefined) {
      this.fail("join_required");
      return;
    }

    if (typeof rawWith !== "string" || rawWith.trim().length === 0) {
      this.fail("invalid_recipient");
      return;
    }

    const other = rawWith.trim();
    if (other === me) {
      this.fail("self_dm");
      return;
    }

    let rows: DmMessageRow[];
    try {
      rows = await dmMessages.findAll();
    } catch {
      this.fail("persistence_failed");
      return;
    }

    const messages = rows
      .filter(
        (row) =>
          (row.fromNickname === me && row.toNickname === other) ||
          (row.fromNickname === other && row.toNickname === me),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
      .map((row) => ({
        id: row.id,
        from: row.fromNickname,
        to: row.toNickname,
        body: row.body,
        createdAt: row.createdAt,
      }));

    this.send = JSON.stringify({ type: "history", with: other, messages });
  }

  private fail(code: string) {
    this.send = JSON.stringify({ type: "error", code });
  }
}

const INDEX_FILE = Bun.file(join(import.meta.dir, "index.html"));

/** Serves the self-contained DM page from the same server as the socket. */
@route("/")
class DirectMessagePage extends Methods {
  get({ res }: ctx): Promise<Response> {
    return res.file(INDEX_FILE);
  }
}

export const app = new Rossa({ Encoding: "none" });
app.register(DirectMessagePage);
app.registerWSS(DirectMessageSocket);

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8788);
  const server = app.serve({ port });
  console.log(`Direct messages listening on http://localhost:${server.port}`);
}
