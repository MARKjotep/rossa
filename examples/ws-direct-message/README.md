# WebSocket direct messages

A runnable Rossa example for one-to-one direct messages. The same server hosts
the page at `/` and the WebSocket endpoint at `/ws`. There are no accounts or
cookies: each tab picks a nickname, presence is process-local, and messages are
stored in SQLite.

## Run

```sh
bun examples/ws-direct-message/server.ts
# or pick another port
PORT=9000 bun examples/ws-direct-message/server.ts
```

Open <http://localhost:8788/> (or the configured port). Open a second tab or
window and join with a **different nickname** — two tabs using the same nickname
will get `nickname_taken`.

## Behavior

- Each joined nickname owns an inbox topic (`dm:<nickname>`). Messages to a
  recipient are published there when that recipient is online.
- A DM is persisted before delivery. The sender's ack includes
  `delivered: true` when the recipient was online, or `delivered: false` when
  the recipient is a known nickname that is currently offline (the message is
  saved for history).
- A nickname is "known" after it has joined during the current server process.
  Sending to a nickname that has never joined that process yields `user_offline`
  and is not saved. After a restart, nicknames become known again when they
  join; stored history remains readable.
- Nicknames are 1–24 characters after trimming. Message bodies are 1–1000
  characters.
- The page loads the conversation history when you pick an online user from the
  roster.
- Roster and presence are in memory and process-local. Messages, including
  messages sent to offline known users, survive a server restart.

## Storage

The server creates `examples/ws-direct-message/data/chat.sqlite` (via `mkdirSync`
and `SQL` with `max: 1`) on startup. The `dm_messages` table stores `id`,
`fromNickname`, `toNickname`, `body`, and `createdAt` (ISO text). The file is
gitignored; delete it to start with empty history.

## Protocol

All frames are JSON text. Connect to `ws://localhost:<port>/ws`.

| Direction       | Message                                                        | Meaning                                                       |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| client → server | `{"type":"join","nickname":"Ada"}`                            | Join and register the nickname.                               |
| server → client | `{"type":"joined","nickname":"Ada"}`                          | Join accepted.                                                |
| server → all    | `{"type":"presence","online":["Ada","Bob"]}`                  | Current roster in join order.                                 |
| client → server | `{"type":"dm","to":"Bob","body":"hello"}`                     | Send a direct message.                                        |
| server → sender | `{"type":"sent","to":"Bob","delivered":true}`                 | Saved; `delivered` says whether Bob was online for live delivery. |
| server → Bob    | `{"type":"dm","id":1,"from":"Ada","body":"hello"}`            | Live direct message.                                          |
| client → server | `{"type":"history","with":"Bob"}`                             | Request the conversation between this client and Bob.         |
| server → client | `{"type":"history","with":"Bob","messages":[...]}`            | Chronological messages, both directions.                      |
| server → client | `{"type":"error","code":"..."}`                               | Application error; the connection remains open.               |

History entries are `{"id":1,"from":"Ada","to":"Bob","body":"hello","createdAt":"..."}`.

### Error codes

| Code                 | When                                                            |
| -------------------- | --------------------------------------------------------------- |
| `invalid_message`    | Missing/unknown command shape, or an empty body.                |
| `unknown_type`       | Unrecognized `type`.                                            |
| `invalid_nickname`   | Nickname is empty after trimming or longer than 24 chars.       |
| `nickname_taken`     | Another active member already uses the nickname.                |
| `invalid_recipient`  | Missing/empty `to` or `with`, or no recipient selected.         |
| `self_dm`            | The recipient is the sender.                                    |
| `user_offline`       | The recipient nickname is unknown (never joined).               |
| `join_required`      | A `dm` or `history` request was sent before `join`.             |
| `already_joined`     | This connection already completed the join handshake.           |
| `message_too_long`   | Body is longer than 1000 characters.                            |
| `persistence_failed` | SQLite could not save the message; nothing was broadcast.       |

## Implementation notes

- The local `knownNicknames` set distinguishes a registered nickname that is
  currently offline (`delivered: false`, still saved) from an unknown nickname
  (`user_offline`).
- Delivery is a publish to `dm:<nickname>`. Bun's `publish` does not echo to the
  publishing socket, so the sender relies on the ack; no self-delivery is
  needed.
- History is read with `dmMessages.findAll()` and filtered/sorted in the
  controller, which keeps the example on the repository API without custom SQL.
- The page is served with a minimal `@route("/")` that uses `res.file()`, so
  there is no build step or static-directory configuration.
