# WebSocket client contract

This guide describes the server behavior a custom client framework needs to
support. Rossa provides WebSocket transport, route matching, guards, lifecycle
hooks, and an in-process topic manager. It does **not** define one universal
application message protocol: each `Websocket` controller chooses its own
commands and reply objects.

## Connection and route

Declare a controller with `@wss(path)` and register it with `app.registerWSS()`:

```ts
@wss("/chat")
class ChatSocket extends Websocket {
  override open() {
    this.send = JSON.stringify({ type: "ready" });
  }

  override message({ json }: wssMessage) {
    // Handle this application's command format.
  }
}

app.registerWSS(ChatSocket);
app.serve({ hostname: "0.0.0.0", port: 3000 });
```

The client connects to the server's WebSocket URL and the registered path, for
example `wss://api.example.com/chat`. A configured `basePath` is prepended to
the route. Named path segments such as `/users/:id` are supported. Use `wss:`
when the HTTP server uses TLS and `ws:` only for local or otherwise plain HTTP.
The client must perform the standard HTTP WebSocket upgrade; after a successful
upgrade, the controller's `open()` runs.

## Authentication

Global guards and controller/method guards run before the upgrade. A denied
handshake returns the guard's HTTP error response, so the client may receive a
handshake failure instead of a WebSocket `close` event. On success, values the
guards put in `ctx.data` are copied to `controller.contextData` before `open()`.

Browser WebSocket APIs do not allow arbitrary request headers. Browser clients
usually authenticate with an appropriate session cookie or obtain a short-lived
connection ticket from an HTTP endpoint. Native clients may send headers through
their WebSocket library. Do not put a long-lived secret in the URL query string.
The application must still authorize the user for each private room and
operation; a successful connection does not grant access to every topic.

## Lifecycle exposed to the client

The server controller has these hooks:

| Server hook | Meaning to the client |
| --- | --- |
| `open()` | The server accepted the connection. It may immediately send a welcome/ready message or subscribe to a room. |
| `message({ text, json, topic })` | The server received a client frame. The client should send text frames; JSON is the normal application format. |
| `drain()` | Bun drained buffered outbound data. This is server-side backpressure handling; it is not a client event. |
| `onClose(code, reason)` | The connection is closing or closed. Runs before `manager.cleanup()`. The client should surface the code/reason and reconnect only according to application policy. |
| `capacityTopics(ctx)` | Before the upgrade, the controller declares the topics it will join so Rossa can enforce `maxClients`. Not a client event. |

`onClose()` is a notification hook; it is not how the server closes a socket.
Server-side close is `this.terminate(code, reason)` (or `this.ws.close(...)`),
after which Bun reports the close and `onClose()` runs. The former
`close(code, reason)` hook is deprecated: it still runs when a subclass
overrides it (and `onClose()` is not overridden), but new code should implement
`onClose()`.

If the controller declares topics through `capacityTopics(ctx)` and one is
already full, the upgrade is answered with HTTP `503 Service Unavailable` before
the WebSocket handshake. The client sees a failed connection attempt, not a
socket that opens and cannot subscribe; it should treat `503` as "room full"
(for example, retry later or choose another room) rather than a protocol error.
Topics not declared there keep the later `subscribe()` throw and the
application's own close policy.

The client runtime receives the standard WebSocket events: open, message,
error, and close. Rossa does not send a mandatory welcome frame or heartbeat;
those are controller/application choices. Reconnection, replay, offline
delivery, and message acknowledgements also belong to the application
protocol.

## Frame encoding

Send a UTF-8 text frame containing either JSON or plain text. Rossa attempts to
parse each incoming frame as JSON:

- For valid JSON, `json` contains the parsed object and `text` is an empty
  string.
- For non-JSON text, `text` contains the original frame and `json` is `{}`.
- If the top-level JSON object has a string `topic` property, Rossa exposes it
  separately as `topic` and removes that property from `json` before calling
  the controller. This does not automatically subscribe, route, or broadcast
  the message. Avoid using a top-level `topic` field for an application command
  unless the controller intentionally wants this behavior.

The server's `this.send = value` sends a string or byte buffer to the current
client. `this.manager.broadcast(topics, value)` JSON-stringifies non-string
values and publishes them to subscribers. There is no framework-level
envelope, so the custom client should treat message shape as endpoint-specific.

Example controller contract:

```json
{"type":"message","text":"Hello"}
```

The controller may reply with any JSON shape, for example:

```json
{"type":"reply","text":"Hi there"}
```

## Group chat example protocol

The included group chat controller at `src/wss/examples/group-chat.ts` uses
`/chat` and JSON commands. It is a sample protocol, not a built-in Rossa
standard.

Join a conversation:

```json
{"type":"join","conversationId":"conversation-123"}
```

On success, the sender receives:

```json
{"type":"joined","conversationId":"conversation-123"}
```

Send a message after joining:

```json
{"type":"send","conversationId":"conversation-123","body":"Hello"}
```

Other subscribed clients receive the persisted record in a broadcast:

```json
{"type":"message","message":{"id":"message-id","conversationId":"conversation-123","senderId":"user-id","body":"Hello","createdAt":"2026-01-01T00:00:00.000Z"}}
```

The sender receives an acknowledgement:

```json
{"type":"sent","messageId":"message-id"}
```

Known sample errors include `invalid_message`, `missing_room`, `forbidden`,
`room_full`, `join_required`, `message_too_long`, and `persistence_failed`.
Render these as application errors rather than transport failures. The sample
persists before broadcasting, checks membership before joining and sending,
and does not deliver to offline clients; load history through a separate HTTP
endpoint.

## Limits and room semantics

`subManager` supports subscribe/unsubscribe, membership queries, room capacity,
admin flags, broadcast, and cleanup. It is a server-side process-local manager;
clients do not send manager methods directly. The default maximum topic payload
is 65,536 bytes and the default client cap is unlimited. A controller can set
per-topic `maxPayloadSize` and `maxClients` before subscribing members.

A full topic is normally detected when `subscribe()` throws. To reject the
handshake instead, declare the topic in `capacityTopics(ctx)`: the upgrade then
answers `503` before any socket opens. The declaration runs after guards, so
`ctx.data` carries auth and room selection, but `this.ws` and `this.manager` do
not exist yet.

Broadcast results use `sent` (`> 0`), `dropped` (`0`), `oversize` (pre-publish
short-circuit), and `backpressured` (Bun `-1`). `backpressured` is Bun-only: it
needs a peer past Bun's outbound drain threshold, and in-process peers always
read, so application code cannot force it. Treat it as a pass-through status
rather than an app branch.

The second argument to `app.serve(serverOptions, websocketOptions)` accepts
Bun WebSocket settings such as `maxPayloadLength`. Rossa's optional
`messageRateLimit: { max, windowMs }` closes a connection that exceeds its
fixed per-connection window with close code `1008`. It is disabled by default.
The client should handle that close as a policy/rate-limit outcome, not loop
reconnecting immediately.

Topic membership, connection limits, and rate-limit counters are process-local.
They do not synchronize across workers or hosts. Multi-instance applications
need shared pub/sub and application-owned authorization and persistence.

## Minimal browser client shape

This small client wrapper demonstrates the transport surface a framework
adapter can expose. Feature-specific command helpers should be layered on top
of `sendJson` and the message subscription:

```ts
type SocketMessage = Record<string, unknown>;

export function connectSocket(url: string) {
  const socket = new WebSocket(url);
  const listeners = new Set<(message: SocketMessage | string) => void>();

  socket.addEventListener("message", (event) => {
    const raw = String(event.data);
    let message: SocketMessage | string;
    try {
      message = JSON.parse(raw) as SocketMessage;
    } catch {
      message = raw;
    }
    for (const listener of listeners) listener(message);
  });

  return {
    socket,
    sendJson(command: Record<string, unknown>) {
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket is not open");
      }
      socket.send(JSON.stringify(command));
    },
    onMessage(listener: (message: SocketMessage | string) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      socket.close();
    },
  };
}
```

Keep transport state (`connecting`, `open`, `closing`, `closed`) separate from
application state (joined conversations, pending commands, current user).
Handle malformed messages and server error envelopes without assuming that
every message is a reply to the last command.
