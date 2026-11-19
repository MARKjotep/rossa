# WebSocket examples

This folder also includes three backend-only mock controllers:

- `telegram-bot.ts` accepts a Telegram-like update and replies with a
  `sendMessage`-shaped object over WebSocket.
- `messenger.ts` accepts a Messenger-like event and returns a mock send-message
  payload.
- `portfolio-chat.ts` provides a small canned-response backend for a portfolio
  chat widget.

These examples only speak over Rossa WebSockets. They do not call Telegram's
Bot API, Meta's Graph API, or an AI service, and they do not include browser
client code. Register just the controller you want to try:

```ts
import { Rossa } from "../../index";
import { TelegramBotMockSocket } from "./telegram-bot";
import { MessengerMockSocket } from "./messenger";
import { PortfolioChatSocket } from "./portfolio-chat";

const app = new Rossa();
app.registerWSS(TelegramBotMockSocket); // /examples/telegram-bot
// app.registerWSS(MessengerMockSocket); // /examples/messenger
// app.registerWSS(PortfolioChatSocket); // /examples/portfolio-chat
app.serve(
  { port: 3000 },
  {
    maxPayloadLength: 8 * 1024,
    messageRateLimit: { max: 20, windowMs: 10_000 },
  },
);
```

Send JSON messages using the selected mock's shape. The socket sends one JSON
reply for each valid message. For example, the Telegram mock accepts:

```json
{ "message": { "chat": { "id": 42 }, "text": "/start" } }
```

and returns:

```json
{ "method": "sendMessage", "chat_id": 42, "text": "Welcome! I’m a demo bot. Send /help to see what I can do." }
```

The Messenger mock expects `{ "sender": { "id": "user-1" }, "message": { "text": "Hello" } }`.
The portfolio chat expects `{ "type": "message", "message": "Tell me about your projects" }` and sends a `ready` event as soon as the connection opens.

For a public portfolio deployment, add your own origin policy, abuse controls,
and a real contact/message handling path. These canned replies are only example
backend behavior.

## One-to-one direct messages

`direct-message.ts` exports `createDirectMessageController(store, limits?)`.
The store extends the group-chat adapter with an atomic
`findOrCreateDirectConversation(currentUserId, otherUserId)` operation. The
database should enforce a unique canonical user pair if the product allows one
DM thread per pair. That prevents two simultaneous starts from creating two
threads. The adapter should also check that the recipient exists and that the
sender is allowed to message them.

```ts
import { Rossa } from "../../index";
import {
  createDirectMessageController,
  type DirectMessageStore,
} from "./direct-message";

declare const directMessageStore: DirectMessageStore; // Implement with your session and database layer.

const app = new Rossa();
app.registerWSS(createDirectMessageController(directMessageStore));
app.serve(
  { port: 3000 },
  {
    maxPayloadLength: 64 * 1024,
    messageRateLimit: { max: 30, windowMs: 10_000 },
  },
);
```

After the session cookie authenticates the connection, send a `start` command
with the other user's application ID. The server finds or creates the private
conversation, checks membership, and subscribes the socket to its private
topic:

```json
{ "type": "start", "recipientId": "user-b" }
```

The sender receives `{ "type": "ready", "conversationId": "..." }`. The
recipient can open their own authenticated socket and send the same `start`
command with the first user's ID. Both sockets resolve to the same persistent
conversation. Send messages with the returned conversation ID:

```json
{ "type": "send", "conversationId": "...", "body": "Hi!" }
```

Messages are persisted before they are published to connected members. Read
history over an authenticated HTTP endpoint; WebSocket topics only reach online
subscribers. Although this is one-to-one like a DM, traffic passes through the
Rossa server. For literal browser-to-browser peer-to-peer media/data, use
WebRTC: the server should authenticate both users and relay WebRTC offer,
answer, and ICE-candidate signaling, while the clients establish the direct
connection.

## Group chat

`group-chat.ts` exports `createGroupChatController(store, limits?)`. Provide an
adapter for your session and database layer, then register the returned class:

```ts
import { Rossa } from "../../index";
import {
  createGroupChatController,
  type GroupChatStore,
} from "./group-chat";

declare const chatStore: GroupChatStore; // Implement with your session and database layer.

const app = new Rossa();
app.registerWSS(createGroupChatController(chatStore));
app.serve({ port: 3000 });
```

The adapter resolves the `session` cookie, checks conversation membership, and
persists messages. Use a shared conversation record for both direct messages
(two members) and group chats (more members). The server creates a private
topic for each conversation only after checking membership.

After authenticating with the session cookie, send JSON commands:

```json
{ "type": "join", "conversationId": "conversation-id" }
```

```json
{ "type": "send", "conversationId": "conversation-id", "body": "Hi!" }
```

The server saves each message before broadcasting it to currently connected
subscribers. Provide a separate HTTP endpoint to load conversation history;
the in-memory WebSocket topic manager does not persist messages or deliver
them to offline users. If the persistence adapter rejects a message write, the
sender receives `{ "type": "error", "code": "persistence_failed" }` and the
message is not broadcast.

The optional `limits` argument overrides `maxMessageLength`,
`maxRoomConnections`, and `maxPublishedBytes`. Incoming frame size and per-socket
message rate are configured on the second `app.serve` argument:

```ts
app.serve(
  { port: 3000 },
  {
    maxPayloadLength: 64 * 1024,
    messageRateLimit: { max: 60, windowMs: 10_000 },
    backpressureLimit: 1024 * 1024,
    closeOnBackpressureLimit: true,
  },
);
```
