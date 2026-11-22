# WebSocket group chat

A small, runnable Rossa example with a single nickname-only lobby. The same
server hosts the page at `/` and the WebSocket endpoint at `/ws`. There are no
accounts or cookies: presence and admin state live in memory, while chat
messages are stored in SQLite.

## Run

```sh
bun examples/ws-group-chat/server.ts
# or pick another port
PORT=9000 bun examples/ws-group-chat/server.ts
```

Open <http://localhost:8787/> (or the configured port), then open a second tab
or window and join with a different nickname.

## Behavior

- The first member to join becomes the admin. The page marks the admin in the
  roster and next to their messages.
- The lobby holds at most **5 active members**. A sixth join gets the
  application error `room_full`; the connection stays open and may retry.
- When the admin disconnects, the longest-connected remaining member is promoted
  and every remaining member receives an updated presence snapshot. When the
  lobby empties, the next joiner becomes admin.
- On a successful join, the client receives the latest 50 persisted messages in
  chronological order as a `history` frame.
- The online roster is clickable. Clicking another member opens a compact 1v1
  panel on the same page and socket. Incoming DMs open (or switch to) the
  sender's panel, so they are always visible.
- 1v1 DMs are **live-routing only**: they are not saved and have no history or
  `delivered` flag. The dedicated `ws-direct-message` example covers persistent
  1v1 messaging. DMs also do not consume the five lobby slots.
- Nicknames are 1–24 characters after trimming. Message bodies are 1–1000
  characters.
- Presence, admin ownership, room capacity, and nickname uniqueness are
  process-local and reset when the server restarts. Messages persist.

## Storage

The server creates `examples/ws-group-chat/data/chat.sqlite` (via `mkdirSync`
and `SQL` with `max: 1`) on startup. The `chat_messages` table stores `id`,
`nickname`, `body`, and `createdAt` (ISO text). The file is gitignored; delete it
to start with empty history.

## Protocol

All frames are JSON text. Connect to `ws://localhost:<port>/ws`.

| Direction      | Message                                                        | Meaning                                                          |
| -------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| client → server | `{"type":"join","nickname":"Ada"}`                            | Join the lobby.                                                  |
| server → client | `{"type":"joined","nickname":"Ada","admin":true}`             | Join accepted. `admin` is `true` only for the first member.      |
| server → all    | `{"type":"presence","online":["Ada","Bob"],"admin":"Ada"}`    | Roster in join order plus the current admin (`null` when empty). |
| server → client | `{"type":"history","messages":[...]}`                         | Latest 50 persisted messages, chronological.                     |
| client → server | `{"type":"send","body":"hello"}`                              | Send a message to the lobby.                                     |
| server → sender | `{"type":"sent","id":1}`                                      | The lobby message was persisted and accepted.                    |
| server → all    | `{"type":"message","id":1,"from":"Ada","body":"hello","createdAt":"..."}` | A lobby chat message. The sender also receives this frame. |
| client → server | `{"type":"dm","to":"Bob","body":"hi"}`                        | Live 1v1 message to a current lobby member.                      |
| server → Bob    | `{"type":"dm","from":"Ada","body":"hi"}`                      | Live 1v1 delivery on Bob's inbox topic (`dm:Bob`).               |
| server → sender | `{"type":"dm_sent","to":"Bob"}`                               | The live DM was routed. Nothing was saved.                       |
| server → client | `{"type":"error","code":"..."}`                               | Application error; the connection remains open.                  |

History entries and live `message` frames share the shape
`{"id":1,"from":"Ada","body":"hello","createdAt":"..."}`.

### Error codes

| Code                 | When                                                        |
| -------------------- | ----------------------------------------------------------- |
| `invalid_message`    | Missing/unknown command shape, or an empty body.            |
| `unknown_type`       | Unrecognized `type`.                                        |
| `invalid_nickname`   | Nickname is empty after trimming or longer than 24 chars.   |
| `nickname_taken`     | Another active member already uses the nickname.            |
| `room_full`          | Five members are already active in the lobby.               |
| `join_required`      | A command needing a join was used before `join`.            |
| `already_joined`     | This connection already completed the join handshake.       |
| `message_too_long`   | Body is longer than 1000 characters.                        |
| `invalid_recipient`  | A `dm` had no usable `to` nickname.                         |
| `user_offline`       | A `dm` recipient is not a current lobby member.             |
| `self_dm`            | A `dm` was addressed to the sender.                         |
| `persistence_failed` | SQLite could not save the message or read history.          |

## Implementation notes

- The lobby is the single topic `chat:lobby`. The controller sets
  `maxClients: 5` on the topic, so the sixth `subscribe` throws and the
  controller converts that into `room_full`.
- `members` maps nickname to a monotonically increasing join sequence. It both
  enforces unique nicknames and defines the admin handoff order.
- A `send` is written with `chatMessages.insert(...)` before any broadcast. If
  the insert fails, the sender gets `persistence_failed` and nobody sees the
  message.
- Every joined member also subscribes to `dm:<nickname>`. A `dm` publishes to
  the recipient's inbox topic and is never written to SQLite; it is only
  delivered while both members stay connected.
- Bun's `publish` does not echo to the publishing socket, so the controller
  sends the joiner its own `presence` and `history` frames and the sender its
  own `message` copy explicitly.
- History is read with `chatMessages.findAll()`, sorted newest-first in the
  controller, limited to 50, then reversed to chronological order.
- The page is served with a minimal `@route("/")` that uses `res.file()`, so
  there is no build step or static-directory configuration.
