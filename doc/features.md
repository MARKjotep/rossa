# Rossa feature reference

This page documents the public surface of Rossa, a Bun and TypeScript web
framework. It covers application setup, routing, guards, request and response
helpers, WebSockets, authentication building blocks, the database layer, typed
field scopes, static files, and production constraints.

For task-oriented guides, see the documents listed at the end of this page.

## Contents

- [Application core](#application-core)
  - [Creating an app](#creating-an-app)
  - [Options](#options)
  - [Registration and serving](#registration-and-serving)
- [Routing](#routing)
- [Guards](#guards)
- [Request context and responses](#request-context-and-responses)
- [WebSockets](#websockets)
- [MCP (Model Context Protocol)](#mcp-model-context-protocol)
- [Authentication](#authentication)
- [Database layer](#database-layer)
- [Typed fields and shared scopes](#typed-fields-and-shared-scopes)
- [Static files](#static-files)
- [Production notes](#production-notes)
- [Related documentation](#related-documentation)

## Application core

### Creating an app

```ts
import { Rossa } from "rossa";

const app = new Rossa({
  basePath: "/api",
  clientPath: "./public",
  Encoding: "br",
});
```

`new Rossa(options)` creates the router, the global guard pipeline, and the
static file server. HTTP and WebSocket controllers are registered separately
afterward.

### Options

| Option           | Type                  | Default      | Behavior                                                                                                           |
| ---------------- | --------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `basePath`       | `string`              | `""`         | Prefix for HTTP and WebSocket routes. A leading slash is added when missing.                                       |
| `clientPath`     | `string`              | `"./public"` | Root directory for static files and `res.fileServer()`.                                                            |
| `dirPath`        | `string`              | `"./src"`    | Anchor for a relative `clientPath`. The client path resolves from the parent directory of this anchor.             |
| `fileExtensions` | `string[]`            | `[]`         | Additional static-file extensions, with or without a leading dot. Built-in extensions are kept.                    |
| `logError`       | `boolean`             | `false`      | Log messages for errors caught at the router pipeline boundary.                                                    |
| `Encoding`       | `ContentEncodingType` | `"br"`       | Preferred response encoding. Supported values: `"br"`, `"gzip"`, `"deflate"`, `"zstd"`, and `"none"`.              |

Encoding is negotiated against the request's `Accept-Encoding` header. When the
client does not accept the configured encoding, the response is sent unencoded.
`res.encode(type)` changes the encoding for one response.

With the defaults, `dirPath` is `<cwd>/src`, so `clientPath: "./public"` resolves
to `<cwd>/public`.

### Registration and serving

```ts
import { Methods, Rossa, route } from "rossa";
import type { ctx } from "rossa";

const app = new Rossa();

@route("/health")
class Health extends Methods {
  get({ res }: ctx) {
    return res.success(200, { status: "ok" });
  }
}

app.register(Health);
app.serve({ hostname: "0.0.0.0", port: 3000 });
```

| Method                         | Purpose                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `app.register(...controllers)` | Register one or more HTTP controller classes that extend `Methods`.                                           |
| `app.registerWSS(...controllers)` | Register one or more WebSocket controller classes that extend `Websocket`.                                 |
| `app.use(...guards)`           | Add global guards. Guards are prepended, so the last call runs first.                                         |
| `app.serve(serverOptions, websocketOptions)` | Call `Bun.serve`. Without a `port`, Rossa uses `3000`. Returns the Bun server.                   |
| `app.test(request, encoding?)` | Run a `Request` through the same pipeline without binding a socket. Returns a `Response`.                     |
| `app.getPaths()`               | Return registered HTTP paths with parameter colons removed.                                                   |

`serverOptions` accepts Bun serve options plus an optional `fn(port)` callback.
`websocketOptions` accepts Bun WebSocket handler options plus Rossa's
`messageRateLimit`. TLS configuration is passed through Bun's `tls` option:

```ts
app.serve({
  port: 443,
  tls: {
    cert: Bun.file(process.env.TLS_CERT_PATH!),
    key: Bun.file(process.env.TLS_KEY_PATH!),
  },
});
```

`app.test()` is useful for assertions and examples. It has no live server, so
it cannot fully exercise SSE streams or WebSocket upgrades.

## Routing

Declare a controller with `@route(path)` and extend `Methods`. Implement any of
the lower-case method names `get`, `post`, `put`, `patch`, `delete`, `head`,
`options`, and `event`:

```ts
import { Methods, Rossa, route } from "rossa";
import type { ctx } from "rossa";

const app = new Rossa();

@route("/users/:id")
class Users extends Methods {
  get({ params, res }: ctx) {
    return res.json({ id: params.id });
  }

  put({ params, req, res }: ctx) {
    return req.json<{ name: string }>().then((body) =>
      res.json({ id: params.id, name: body.name }),
    );
  }

  delete({ params, res }: ctx) {
    return res.null(204);
  }
}

app.register(Users);
```

- Named segments such as `:id` match one non-empty path segment. Values in
  `ctx.params` are strings.
- A trailing slash is accepted. The query string does not participate in route
  matching.
- `app.getPaths()` returns paths with parameter colons removed, for example
  `["/users/id"]`.
- `basePath` is prepended to every registered HTTP and WebSocket path.
- `event` is selected for GET requests whose `Accept` header allows
  `text/event-stream`. Other methods keep normal dispatch.

### Inherited OPTIONS

`Methods` supplies an inherited `options` handler. Every declared path accepts
OPTIONS and returns an empty `204` response with an `Allow` header built from the
methods registered for that path, including OPTIONS. OPTIONS to an undeclared
path still returns `404`. Override `options` to customize the response.

CORS preflight behavior is controlled by the CORS guard; the inherited OPTIONS
handler only advertises allowed methods.

## Guards

Guards validate a request, enrich `ctx`, or wrap downstream work. A guard
factory is configured first and returns the guard function:

```ts
import { Methods, Rossa, rateLimit, route, use } from "rossa";

const app = new Rossa();
app.use(rateLimit({ max: 120, windowMs: 60_000 }));

@route("/reports")
@use(rateLimit({ max: 10, windowMs: 60_000 }))
class Reports extends Methods {
  get() {
    return Response.json({ ok: true });
  }
}
```

### Ordering

`app.use` prepends to the global pipeline. Calling `app.use(a)` and then
`app.use(b)` means `b` runs before `a`. Wrapper guards such as `errorHandler`
and `security` should be registered after the guards whose responses they
should wrap. `@use` guards on a class run before method-level guards; both run
after the global pipeline.

### Built-in guards

| Guard                       | Behavior                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `authBearer(check)`         | Reads `Authorization: Bearer <token>` and calls `check(ctx, token)` (sync or async).                                  |
| `apiKey(check)`             | Reads `x-api-key` and calls `check(ctx, key)`.                                                                        |
| `auth(checks)`              | Takes a map of header names to validators; every listed header must be present and pass.                              |
| `authorize(check)`          | Runs a sync or async policy callback with `ctx`. Returns `403` when it denies access. Use after authentication.       |
| `cookies(name)`             | Requires the named cookie to exist; returns `401` when missing. Read the value with `ctx.req.cookies.get(name)`.      |
| `json(schema)`              | Checks content type and a 1 MiB default limit on POST/PUT/PATCH, parses JSON, validates it, and stores it in `ctx.req._json`. |
| `keys(names)`               | Parses JSON, checks required top-level keys, then stores the body in `ctx.body`. Does not validate field types.       |
| `multipart()`               | Parses `multipart/form-data` into `ctx.form`. Uploads stay `File` objects; repeated names become arrays.              |
| `urlencoded()`              | Parses `application/x-www-form-urlencoded` into `ctx.form`; repeated names become arrays.                             |
| `validateQuery(schema)`     | Coerces and validates query values into `ctx.query`. Duplicate names keep the last value.                             |
| `validateForm(schema)`      | Parses and validates form values into `ctx.form`. Duplicate names keep the last value.                                |
| `validateUrl(options?)`     | Checks URL and query length, duplicate or disallowed keys, value patterns, malformed escapes, null bytes, and traversal. |
| `contentType(rule)`         | Accepts a MIME type, a list, or a sync predicate. Parameters such as `charset` are ignored.                            |
| `cors(options)`             | Applies CORS headers and validates origins. Supports `origin`, `allowHeaders`, `exposeHeaders`, `credentials`, and `maxAge`. |
| `csrf(options?)`            | Compares a header (default `x-csrf-token`) with the `csrf_token` cookie on POST, PUT, PATCH, and DELETE.               |
| `header(rules)`             | Requires header names or validates them with a map of synchronous checks.                                             |
| `ipFilter(options)`         | Applies `whitelist` and `blacklist` rules for IPv4 addresses, wildcard patterns, and CIDR ranges.                     |
| `rateLimit(options?)`       | In-memory fixed-window request limit keyed by IP, method, and path. Defaults: 100 requests per 60 seconds.            |
| `sanitize(options?)`        | Escapes HTML-sensitive characters in parsed query, form, body, and JSON values.                                       |
| `security(options?)`        | Adds response security headers. `nosniff`, `DENY`, and `strict-origin-when-cross-origin` are on by default.           |
| `jwtAuth(service)`          | Verifies an access token and stores claims in `ctx.jwtData`.                                                          |
| `jwtRefresh(service)`       | Reads `x-refresh-token`, consumes it, issues a replacement pair in `ctx.data.jwtTokens`, and stores claims.           |
| `session(service)`          | Loads `ctx.session`, runs downstream work, then persists or deletes changes. Creates an anonymous session when none exists. |
| `smartCache({ ttlMs })`     | In-memory GET response cache keyed by full URL. Requests with cookies, authorization, or range headers bypass it. Use only for public responses. |
| `staticFiles()`             | Serves GET and HEAD requests for recognized file paths through the static file server.                               |
| `logger(label?)`            | Logs method, path, and timestamp before downstream work.                                                             |
| `loggerFN(formatter)`       | Calls a formatter after downstream work and logs a truthy result.                                                     |
| `timeout(milliseconds)`     | Stops waiting after the limit and returns `408`. It cannot cancel work already running.                               |
| `errorHandler(options?)`    | Catches thrown errors from downstream guards and handlers; returns a generic `500` unless `onError` is supplied.      |

`schema` values are built with the zod-style `z` API: `z.object({ ... })`,
`z.string()`, `z.number()`, `z.boolean()`, and `z.array(item)`, with `min`,
`max`, `int`, `email`, `optional`, `nullable`, and `default` modifiers. Use
`z.coerce.*` for query and form values, which arrive as strings. Unknown object
keys are stripped from parsed output. See the schema helper section in the
guards guide for examples.

### Custom guards

`createGuard<TOptions>()` defines reusable logic. The handler receives
`(ctx, next, options, errorConfig)`. Return or await `next()` to continue, and
call it only once. Use `sendError(errorConfig)` to apply the configured status,
message, headers, or redirect.

```ts
import { createGuard, sendError, use } from "rossa";

const requireTenant = createGuard<{ allowedIds: string[] }>(
  async (ctx, next, options, errorConfig) => {
    const tenantId = ctx.req.headers.get("x-tenant-id");
    if (!tenantId || !options.allowedIds.includes(tenantId)) {
      return sendError(errorConfig);
    }
    ctx.data.tenantId = tenantId;
    return await next();
  },
  { id: "require-tenant", code: 403, message: "Tenant is not allowed." },
);

app.use(requireTenant({ allowedIds: ["tenant-123"] }));

@use(requireTenant({ allowedIds: ["tenant-123"] }))
class TenantController {}
```

The per-use second argument can override `message`, `headers`, or `redirect`.
The status code is taken from the default configuration passed to
`createGuard`.

## Request context and responses

### `ctx`

Each request receives a `ctx` instance with:

| Field             | Description                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `req`             | `Req` wrapper around the native `Request`.                                                   |
| `res`             | `Res` response builder.                                                                      |
| `params`          | Route parameters as strings.                                                                 |
| `method`          | Resolved method, including the internal `EVENT` method for SSE requests.                     |
| `methods`         | Methods registered for the matched route, used by the inherited OPTIONS handler.              |
| `data`            | Request-local record for guard and handler values.                                           |
| `jwtData`         | Claims populated by JWT guards.                                                              |
| `session`         | Session proxy populated by `session(service)`.                                               |
| `body`            | Body populated by `keys(names)`.                                                             |
| `form`            | Parsed form values populated by form guards.                                                 |
| `query`           | Validated query values populated by `validateQuery()`.                                       |
| `headr`           | Header builder (`Heder`) for assembling response headers.                                    |
| `url`             | Parsed request `URL`.                                                                        |
| `clientDirectory` | Resolved static-file root.                                                                   |

### `Req`

The request wrapper caches text, JSON, form data, URL, query, and cookie state
so multiple helpers can read the same request safely.

| Member                     | Description                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `request`                  | Native `Request`.                                                                            |
| `server`                   | Bun server when the request came from `app.serve()`.                                          |
| `text()`                   | Cached raw body text. Returns `""` on failure.                                               |
| `json<T>()`                | Cached parsed JSON. Returns an empty object when parsing fails; use validation guards for trust. |
| `form()`                   | Parsed `FormData` for form content types; returns an empty `FormData` otherwise.             |
| `url`                      | Cached `URL`.                                                                                |
| `query`                    | Query parameters as a plain record. Duplicate names keep the last value.                     |
| `cookies`                  | `Map<string, string>` parsed from the `Cookie` header.                                       |
| `auth`                     | Bearer token from `Authorization`, or `undefined`.                                           |
| `method`                   | Upper-case HTTP method.                                                                      |
| `headers`                  | Native `Headers`.                                                                            |
| `header(name)`             | Single header lookup.                                                                        |
| `ip`                       | `SocketAddress` from Bun, or `null`.                                                         |
| `path`                     | URL pathname.                                                                                |
| `isForm`                   | True for multipart or URL-encoded content types.                                             |
| `isWSS`                    | True when the request asks to upgrade to WebSocket.                                          |
| `isEventStream`            | True for GET requests whose `Accept` allows `text/event-stream`.                              |
| `isFile`                   | True when the last path segment has a recognized static-file extension.                       |
| `getAuthCredentials()`     | Reads session cookie, bearer token, and form `refresh_token`.                                |
| `upgrade(data)`            | Calls Bun's server upgrade for the request and returns whether it succeeded.                 |

There is no separate `files` helper. Use `req.form()` or the `multipart()` guard
to read uploads; uploaded entries remain `File` objects.

### `Res`

`res` keeps status, headers, and encoding state for the current response. Most
methods return a standard `Response`.

| Member                     | Description                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `status(code)`             | Set the response status. Returns `res` for chaining.                                         |
| `header(input)`            | Add or replace headers. `Vary` values are merged.                                             |
| `encode(type)`             | Set or clear the response content encoding.                                                  |
| `null(status?)`            | Empty response with the given or current status.                                             |
| `json(value)`              | `application/json` response.                                                                 |
| `html(body)`               | `text/html; charset=utf-8` response.                                                         |
| `text(body?)`              | `text/plain; charset=utf-8` response.                                                        |
| `success(code?, data?, message?)` | JSON `{ success: true, ... }` response.                                               |
| `error(code, message)`     | Error response; records become JSON, strings become `text/plain`.                            |
| `redirect(url, status?)`   | Empty redirect with `Location`; default status `302`.                                        |
| `file(file, meta?, headers?)` | Send a Bun file or `Uint8Array`. Bun files support byte ranges and return `416` for invalid ranges. |
| `fileServer()`             | Serve the current request through the configured static file server.                          |

For SSE, use the `res.event` helpers:

```ts
@route("/events")
class Events extends Methods {
  event({ res }: ctx) {
    return res.event.asyncStream(async function* () {
      yield { type: "connected" };
      yield { type: "tick", at: new Date().toISOString() };
    });
  }
}
```

| Helper                        | Behavior                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `res.event.asyncStream(gen)`  | Emits each yielded value as an SSE `data:` message. Objects are JSON-encoded.                 |
| `res.event.eStream(push, opts)` | Interval-driven SSE with optional `event`, `id`, `retry`, and `end` metadata.              |
| `res.event.readableStream(producer, onCancel?)` | Gives the producer direct control of the stream controller.                  |

Each SSE helper returns `text/event-stream`, disables Bun's request timeout, and
returns `500` when the response builder has no live server. SSE is one-way; use
WebSockets for bidirectional messaging.

## WebSockets

Declare a controller with `@wss(path)`, extend `Websocket`, and register it with
`app.registerWSS`:

```ts
import { Rossa, Websocket, wss } from "rossa";
import type { wssMessage } from "rossa";

const app = new Rossa();

@wss("/chat")
class Chat extends Websocket {
  open() {
    this.manager.subscribe("lobby");
    this.send = JSON.stringify({ type: "ready" });
  }

  message({ json }: wssMessage) {
    this.manager.broadcast(["lobby"], json);
  }

  drain() {
    // Bun has drained buffered outbound data.
  }

  close(code: number, reason: string) {}
}

app.registerWSS(Chat);
```

### Lifecycle

| Hook                        | When it runs                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `open()`                    | After a successful upgrade.                                                                  |
| `message({ text, json, topic })` | On each inbound frame. Valid JSON populates `json`; non-JSON text populates `text`.      |
| `drain()`                   | When Bun has drained buffered outbound data.                                                  |
| `close(code, reason)`       | When the connection closes.                                                                  |

`this.send = value` sends a string or byte buffer to the current socket.
`this.ws` is the native Bun `ServerWebSocket`. `this.manager` is a
per-connection `subManager`. Values that guards put in `ctx.data` before the
upgrade are copied to `this.contextData` before `open()`.

If a JSON frame has a top-level string `topic`, Rossa exposes it as `topic` and
removes it from `json`. This does not automatically subscribe or route the
message.

### Topics and broadcasting

`subManager` is backed by the exported process-wide `WSSMAN` singleton.

```ts
this.manager.subscribe("room-1");
this.manager.setTopicConfig("room-1", {
  maxClients: 50,
  maxPayloadSize: 16_384,
});

const results = this.manager.broadcast(["room-1"], { type: "message" });
// [{ topic: "room-1", status: "sent" }]
```

| `subManager` method              | Purpose                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `subscribe(topic)`               | Subscribe the current socket. Throws when the room is full or closed.      |
| `unsubscribe(topic)`             | Leave a topic.                                                             |
| `isSubscribed(topic)`            | Check the current socket's membership.                                     |
| `broadcast(topics, data)`        | Publish to unique topics; returns per-topic publish results.               |
| `setAdmin(topic)` / `isAdmin(topic)` | Track and query room admin flags.                                      |
| `setTopicConfig(topic, config)`  | Set `maxClients` and `maxPayloadSize` for a topic.                         |
| `cleanup()` / `unregister()`     | Remove the connection and its topic memberships.                           |

`WSSMAN` additionally exposes `getMemberDetails(topic)`, `getUserTopics(id)`,
and `get(topic)`. `WssConfig` supports:

| Option           | Default    | Meaning                                                                    |
| ---------------- | ---------- | -------------------------------------------------------------------------- |
| `maxClients`     | `Infinity` | Maximum members in a topic.                                                |
| `maxPayloadSize` | `65536`    | Maximum broadcast payload bytes for the topic.                             |

`broadcast()` JSON-stringifies non-string values. Each result status is one of:

| Status          | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| `sent`          | Bun accepted the publish.                                        |
| `backpressured` | Bun reported `-1`; the socket has buffered data.                 |
| `dropped`       | Bun reported `0`; the message was not delivered.                 |
| `oversize`      | The payload exceeded the topic's `maxPayloadSize`.               |

### Limits

Pass Bun WebSocket options and Rossa's `messageRateLimit` as the second
`app.serve` argument:

```ts
app.serve(
  { port: 3000 },
  {
    maxPayloadLength: 64 * 1024,
    backpressureLimit: 1024 * 1024,
    closeOnBackpressureLimit: true,
    messageRateLimit: { max: 60, windowMs: 10_000 },
  },
);
```

`maxPayloadLength` limits incoming frame size. `messageRateLimit` is optional,
per-connection, fixed-window, and closes a socket that exceeds the limit with
close code `1008`. No per-socket message limit is applied by default.
`maxPayloadSize` on a topic applies to manager broadcasts, not inbound frames.

A WebSocket route and an HTTP route may share the same path; duplicate paths
within the same transport are rejected during registration.

## MCP (Model Context Protocol)

The Model Context Protocol (MCP) is an open protocol for exposing tools,
resources, and prompts to LLM clients. Rossa mounts an MCP endpoint over
Streamable HTTP using the official `@modelcontextprotocol/server` v2 SDK and its
`createMcpHandler`. The handler serves the `2026-07-28` specification revision
and falls back to stateless 2025-era requests.

### Decorator controllers

`@mcp(path?, options?)` marks an `McpController` subclass. `path` defaults to
`/` and resolves under the app's `basePath`. Implement the abstract
`build(server: McpServer): void | Promise<void>` method to register tools,
resources, and prompts:

```ts
import { McpController, McpServer, Rossa, mcp } from "rossa";

const app = new Rossa({ basePath: "/api" });

@mcp("/mcp", {
  origin: ["https://app.example.com", "https://admin.example.com"],
})
class Assistant extends McpController {
  async build(server: McpServer) {
    server.registerTool(
      "echo",
      { description: "Echo a fixed value" },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );
  }
}

app.registerMCP(Assistant); // POST /api/mcp
```

`registerMCP` accepts the decorated class or an instance. A class without
`@mcp` throws. The decorator records only the path and `McpOptions`; there is no
per-controller server-name or version option yet. Decorated controllers use the
server identity `{ name: <ClassName>, version: "0.0.0" }`.

### Raw factories

Use the `(path, factory, options?)` overload when you need an explicit path or
custom server identity:

```ts
import { McpServer } from "rossa";
import type { McpRequestContext } from "rossa";

app.registerMCP(
  "/mcp",
  (context: McpRequestContext) =>
    new McpServer({ name: "raw-assistant", version: "1.0.0" }),
  { origin: "https://app.example.com" },
);
```

The factory runs once per request and may return a `Promise`. A zero-argument
factory is also valid. Registering the same MCP path again replaces the previous
endpoint. Mounting an MCP endpoint on an existing normal HTTP path throws, and
mounting a normal HTTP route on an existing MCP path throws.

### Options and Origin checks

| Option   | Type                 | Behavior                                                                                                        |
| -------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `origin` | `string \| string[]` | Allowed browser origins. Omit to disable Origin validation; production apps should set it or enforce CORS/IP policy upstream. |

Origin entries may be:

- Full origins such as `https://app.example.com`, matched exactly by scheme,
  host, and port.
- Bare hostnames such as `app.example.com`, matched port-agnostically.
- Scheme wildcards such as `moz-extension://*`.

Requests without an `Origin` header always pass, because non-browser MCP
clients do not send one. A request whose `Origin` does not match returns `403`
with an SDK JSON-RPC error body.

Decorator options are merged with per-call options. A per-call `origin`
overrides the decorator's value.

### Guards and CORS

Global `app.use(...)` guards run before the MCP endpoint and can block it; for
example, a required-header guard rejects an unauthenticated MCP request before
the SDK handler runs.

MCP routes are registered programmatically, so route-level `@use(...)` cannot
attach to them. Guards that only write headers to `ctx.res`, such as `cors()`,
do not decorate the SDK's `Response`, because the MCP handler returns that
response directly. For MCP-specific CORS, prefer the `origin` option or handle
CORS at a reverse proxy.

### HTTP method behavior

| Request  | Result                                                                 |
| -------- | ---------------------------------------------------------------------- |
| `POST`   | Served by the MCP handler as JSON or an SSE stream.                    |
| `GET`    | `405 Method Not Allowed`.                                              |
| `DELETE` | `405 Method Not Allowed`.                                              |
| `OPTIONS`| `404 Not Found`; CORS preflight is the application's or proxy's job.   |
| `HEAD`   | `404 Not Found`.                                                       |

GET requests with `Accept: text/event-stream` still return `405`; Rossa maps
them to the internal `EVENT` method but the MCP handler only serves POST.
Origin validation runs before method dispatch, so a request with a disallowed
`Origin` returns `403` for any method.

### Per-request lifecycle

A fresh `McpServer` is created for every HTTP request, and `build()` runs each
time before the server handles the exchange. The controller instance itself is
created once at registration (or supplied by the caller), so fields on the
controller are shared by concurrent requests. Keep request-specific state in
locals inside `build()` or in the factory closure, and only keep mutable
controller fields for intentionally shared application state.

### SDK authoring reference

Tools, resources, prompts, schemas, and result shapes are defined by the
official SDK, not by Rossa. See the
[official TypeScript SDK documentation](https://ts.sdk.modelcontextprotocol.io/v2/)
for `McpServer.registerTool`, resource, and prompt authoring guides.

Rossa's `z` schemas implement the
[Standard Schema](https://standardschema.dev/) and Standard JSON Schema
interfaces, so they can be passed directly to `server.registerTool` and
`server.registerPrompt` without an adapter:

```ts
import { z } from "rossa";

server.registerTool(
  "echo",
  {
    description: "Echo text",
    inputSchema: z.object({ text: z.string().trim().min(1) }),
  },
  async ({ text }) => ({ content: [{ type: "text", text }] }),
);
```

The SDK uses `~standard.validate` to check incoming tool arguments and
`~standard.jsonSchema.input` to advertise the argument shape in `tools/list`.

## Authentication

Rossa provides building blocks. The application owns identity, storage, account
policy, and topic authorization.

### Sessions

Subclass `SessionAuthInterface`, implement `fetchData`, `saveSession`, and
`deleteSession`, then register the service with `session(service)`:

```ts
import { session } from "rossa";
import { AppSessionAuthService } from "./session-auth-service";

const sessions = new AppSessionAuthService(
  db,
  { COOKIE_SECURE: true, COOKIE_HTTPONLY: true, COOKIE_SAMESITE: "Lax" },
  process.env.SESSION_SECRET!,
);

await sessions.init();
app.use(session(sessions));
```

The guard loads `ctx.session` before the handler and persists changes after the
handler returns if the session was modified. Assign fields directly:

```ts
@route("/login")
class Login extends Methods {
  async post({ session, res }: ctx) {
    (session as any).userID = "user-1";
    return res.success(200, { userID: "user-1" });
  }
}
```

`ServerSide` stores the session ID, data, and `isNew`, `isModified`,
`isReadOnly`, and `isFound` flags behind a proxy. Without a valid session
cookie, `session(service)` creates an anonymous session; check an application
identity such as `ctx.session.userID` on protected routes. There is no
`requireSession` guard.

`AuthConfig` controls `COOKIE_NAME`, `COOKIE_LIFETIME`, `COOKIE_DOMAIN`,
`COOKIE_PATH`, `COOKIE_HTTPONLY`, `COOKIE_SECURE`, `COOKIE_SAMESITE`,
`MAX_COOKIE_SIZE`, and `SESSION_LIFETIME`.

### JWT

`JWTAuthService` signs HS256 access tokens and manages one-time refresh tokens
through an injected `JwtRefreshTokenStore`:

```ts
import { JWTAuthService, jwtAuth, jwtRefresh } from "rossa";

const jwt = new JWTAuthService(
  {
    initialize: async () => {},
    save: async (token, expiresAt) => {
      // Persist until expiresAt (Unix milliseconds).
    },
    consume: async (token) => {
      // Atomically remove the token; return true only for the winning caller.
      return true;
    },
  },
  process.env.JWT_SECRET!,
  { tokenValidity: 15, refreshValidity: 7 },
);

app.use(jwtAuth(jwt));

@route("/refresh")
@use(jwtRefresh(jwt))
class Refresh extends Methods {
  post({ data, res }: ctx) {
    return res.json({ tokens: data.jwtTokens });
  }
}
```

The store's `consume()` must be atomic to prevent concurrent reuse. Access
tokens default to 15 minutes and refresh tokens to 7 days. `jwtAuth` stores
verified claims in `ctx.jwtData`; `jwtRefresh` reads `x-refresh-token`,
consumes it, and issues a replacement pair. See
[`doc/session-auth.md`](session-auth.md) for an SQLite-backed session service.

## Database layer

The database layer wraps Bun's SQL client with typed schemas, a repository, and
dialect adapters. SQLite needs no additional driver.

```ts
import { DbRepository, DbSchema, sqliteDialect, t } from "rossa";
import type { SQL } from "bun";

interface UserRow {
  id: number;
  name: string;
}

declare const db: SQL; // Bun SQL connection configured for SQLite

const users = new DbRepository<UserRow>(
  db,
  new DbSchema(
    "users",
    {
      id: t.serial().primary,
      name: t.text().notNull,
    },
    sqliteDialect,
  ),
);

await users.create();
await users.insert({ id: 0, name: "Rosa" });
const rosa = await users.find({ name: "Rosa" });
```

### Columns and schema

`t` provides logical column builders: `text()`, `int()`, `bigint()`,
`boolean()`, `json()`, `timestamp()`, `serial()`, and `numeric(precision,
scale)`. A `Column` supports `.primary`, `.notNull`, `.unique`, `.defaultNow`,
and `.default(value)`.

`DbSchema<T>` combines a table name, typed column definitions, and a dialect. It
can emit DDL (`createSQL`) and column definitions, and it exposes `columns` for
type-safe references. The selected dialect maps logical types to native column
types.

### Repository

`DbRepository<T>` provides:

- `create()` and `syncColumns(allowDrop?)`.
- `testConnection()` and `withContext(sql)`.
- `insert`, `find`, `findAll`, `paginate`, `count`, and `exists`.
- `update`, `delete`, and `transaction`.
- `inspect` for a bound `DbInspector`.

`syncColumns()` adds missing columns and keeps existing data. Pass `true` only
when dropping columns is intentional. `Where<T>` values may be plain values or
`{ operator, value }` objects. Supported operators include `=`, `!=`, `<`,
`<=`, `>`, `>=`, `LIKE`, `ILIKE`, `IS`, `IS NOT`, `IN`, and `NOT IN`. Values are
bound as parameters; keep table and column names in trusted schema definitions.

### Dialects

The package exports `sqliteDialect`, `postgresDialect`, `mysqlDialect`,
`mariadbDialect`, and `getDialect(name)` for `"sqlite"`, `"postgres"`, `"mysql"`,
and `"mariadb"`. Bun's `mysql2://` URL works with `mysqlDialect`.

### Inspector

`DbInspector<T>` (or `repository.inspect`) exposes `listTables()`,
`dropTable()`, `truncateTable()`, `getTableStats()`, `getTableIndices()`,
`getTableSchema()`, `getTableData(limit?, offset?)`, and `optimize()`.

See [`doc/db.md`](db.md) for repository examples, schema changes, and dialect
behavior.

## Typed fields and shared scopes

`Field` creates named, typed value scopes and field decorators for controller
properties:

```ts
import { Field, Methods, Rossa, route } from "rossa";
import type { ctx } from "rossa";

const site = Field.register({
  info: { name: "Rossa", version: "1.0.0" },
}).use("info");

@route("/about")
class About extends Methods {
  @site.name readonly siteName!: string;
  @site.version readonly version!: string;

  get({ res }: ctx) {
    return res.json({ name: this.siteName, version: this.version });
  }
}

const app = new Rossa();
app.register(About);
```

Each decorator name must match a property in the registered scope, and
TypeScript checks the decorated property against the scope value's type.
`Field.register(...)` stores a sealed shallow copy. `Field.use<T>(name)` returns
the decorator proxy from another module; registering again replaces the stored
object for later lookups.

`Scope` provides the same registry without decorators:

```ts
import { Scope } from "rossa";

const settings = Scope.register({
  app: { name: "Rossa", greet: (name: string) => `Hello, ${name}!` },
}).use("app");

const name = settings.name;
```

`Scope.use<T>(name)` throws when the name is not registered. `Field` and
`Scope` have separate registries. They hold shared application configuration,
not request-local state; use `ctx.data`, `ctx.session`, or another
request-scoped service for per-user values.

See [`doc/field-scopes.md`](field-scopes.md) and [`doc/scopes.md`](scopes.md).

## Static files

Rossa recognizes common web, image, font, text, and JSON extensions by default,
including HTML, CSS, JavaScript, JSX/TSX source, XML, common image formats, SVG,
ICO, WOFF/WOFF2, TXT, and JSON. Add application-specific extensions when
constructing the app:

```ts
const app = new Rossa({ fileExtensions: [".pdf", ".wasm"] });
```

Extensions may include or omit the leading dot. Additions do not remove
built-ins. `req.isFile` reports whether the last path segment has a recognized
extension.

`res.fileServer()` serves the current request from `clientPath`:

```ts
@route("/:file")
class Assets extends Methods {
  get({ req, res }: ctx) {
    if (req.isFile) return res.fileServer();
    return res.null(404);
  }
}
```

Serving behavior:

- The resolved path must remain inside the client root, including after
  `realpath` symlink resolution. Escapes return `403`.
- Missing files return `404`.
- Files up to 50 KiB are cached in memory for 15 minutes and served with a weak
  `ETag` and `Cache-Control: public, max-age=900, must-revalidate`.
- A matching `If-None-Match` returns `304`.
- Larger files are sent with `res.file()`.
- `res.file()` sends Bun files with byte-range support; `Uint8Array` files do
  not support ranges. Invalid ranges return `416`.

The cache is process-local and per-worker.

## Production notes

- **In-process state.** `WSSMAN`, room membership, HTTP and WebSocket rate
  counters, and the small-file cache live in memory and do not synchronize
  across processes or hosts. Multi-instance deployments need shared pub/sub,
  shared session/membership state, and a shared rate-limit store.
- **TLS.** Pass Bun's `tls` option to `app.serve`. Keep private keys in
  deployment secrets, use a trusted certificate chain, and verify renewal,
  hostname coverage, and proxy termination in the hosting environment.
- **Proxy and IP handling.** `req.ip` comes from Bun's `requestIP`. Review
  forwarded-header handling for the deployment topology before relying on IP
  allowlists or rate limits behind a reverse proxy.
- **Cookies.** The framework provides session cookie construction, but the
  application chooses `Secure`, `HttpOnly`, `SameSite`, domain, path, and
  expiry policy in `AuthConfig` or its adapter. Verify that policy for the
  deployment.
- **WebSocket limits.** Topic `maxPayloadSize` applies to broadcasts; Bun's
  `maxPayloadLength` applies to inbound frames. Configure both for the
  application's traffic.
- **Authorization.** The topic manager tracks membership and admin flags but
  does not enforce an application ACL. Authorize a user before subscribing a
  socket to a private topic and before accepting a private message.
- **Load testing.** `bun run test:load` runs a configurable WebSocket fan-out
  workload and reports delivery, latency, publish statuses, and RSS change. It
  is a benchmark, not a capacity guarantee; run it at representative rates in
  staging.
- **Error logging.** `logError` logs pipeline-boundary errors. Guard-specific
  failures can behave differently and should be tested with the application's
  chosen guards.

## Related documentation

| Document                                                   | Contents                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| [`doc/guards.md`](guards.md)                               | Guard behavior, validation options, custom guards.        |
| [`doc/websockets.md`](websockets.md)                       | WebSocket client contract, handshake, lifecycle, limits.  |
| [`doc/session-auth.md`](session-auth.md)                   | Session service implementation and SQLite login example.  |
| [`doc/db.md`](db.md)                                       | Repository, schema, dialects, schema synchronization.     |
| [`doc/field-scopes.md`](field-scopes.md)                   | Typed `Field` decorators in routes.                       |
| [`doc/scopes.md`](scopes.md)                               | Shared `Scope` values.                                    |
| [`doc/routing-style.md`](routing-style.md)                 | Route registration and matching model.                    |
| [`src/db/dialects/README.md`](../src/db/dialects/README.md) | Adding a database dialect.                                |
| [`src/wss/examples/README.md`](../src/wss/examples/README.md) | Group chat, direct message, and bot examples.           |
