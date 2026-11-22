# Rossa

Rossa is a Bun HTTP server with decorator-based routing, request guards, a
response/context API, SSE, WebSocket routes, authentication building blocks,
and a small SQL repository layer. This README is the quick start; see
[`doc/features.md`](doc/features.md) for the complete feature reference.

## Install

Rossa requires Bun. In an application, install the published package and import
its public API from `rossa`:

```sh
bun add rossa
```

The published package ships bundled JavaScript and TypeScript declarations under
`dist/`. From a source checkout, run `bun run builder.ts` before packing;
`bun pm pack --dry-run` previews the files included. The project intentionally
has no `build` npm script.

## Create a server

Import the public API from the package entry point, create a `Rossa` instance,
declare controller classes, then register them. Route decorators use a path
pattern; named segments such as `:id` are available in `ctx.params`.

```ts
import { Methods, Rossa, route } from "rossa";
import type { ctx } from "rossa";

const app = new Rossa();

@route("/users/:id")
class Users extends Methods {
  get({ params, res }: ctx): Response {
    return res.json({ id: params.id });
  }
}

app.register(Users);
app.serve({ port: 3000, hostname: "localhost" });
```

Call `app.getPaths()` after registering controllers to list HTTP paths, including
any `basePath`, with parameter colons removed (for example `["/users/id"]`).

`Rossa` accepts these options:

| Option           | Default      | Purpose                                                                                                   |
| ---------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| `basePath`       | `""`         | Prefix added to registered HTTP and WebSocket routes.                                                     |
| `clientPath`     | `"./public"` | Directory used by `res.fileServer()`. A relative path is resolved from the parent of `dirPath`.           |
| `dirPath`        | `"./src"`    | Anchor used to resolve a relative `clientPath`.                                                           |
| `fileExtensions` | `[]`         | Additional extensions to recognize, with or without a leading dot. Built-in extensions remain recognized. |
| `logError`       | `false`      | Log errors caught by the router pipeline.                                                                 |
| `Encoding`       | `"br"`       | Response encoding; supports the `ContentEncodingType` values.                                             |

`app.serve(serverOptions, websocketOptions)` starts Bun's server. The first
argument accepts Bun serve options plus an optional `fn(port)` callback. The
second argument accepts Bun WebSocket options plus Rossa's optional
`messageRateLimit`. If no port is provided, Rossa uses `3000`.

`app.test(request, encoding?)` runs a `Request` through the same pipeline
without binding a socket. `app.registerWSS(...)` registers WebSocket
controllers, described below.

## Routes and request context

Extend `Methods` and define lower-case HTTP methods such as `get`, `post`,
`put`, `patch`, `delete`, `head`, and `options`. `event` handles server-sent
event requests. A route method receives `ctx`, whose `req` provides request
data and whose `res` builds the response.

```ts
@route("/notes")
class Notes extends Methods {
  async post({ req, res }: ctx): Promise<Response> {
    const note = await req.json<{ title: string }>();
    return res.status(201).json(note);
  }
}
```

Rossa supplies an inherited `options` handler for each declared path. It
returns `204` with an `Allow` header built from the methods registered for that
path.

Useful response methods include `text`, `html`, `json`, `success`, `error`,
`redirect`, `null`, `file`, and `fileServer`. Route parameters are exposed as
strings on `ctx.params`; query parameters are available from `ctx.req.query`.
Guards may place validated values on `ctx.query`, `ctx.body`, or `ctx.form`.

For SSE, a GET request whose `Accept` header allows `text/event-stream` routes
to `event`. Return `res.event.asyncStream(...)`, `res.event.eStream(...)`, or
`res.event.readableStream(...)`; these require a live Bun server.

## Guards

Use `app.use(...)` for application-wide guards. Use the `@use(...)` decorator
on a controller class or individual method for narrower scope. A guard factory
is configured first, then the returned guard is passed to `use`:

```ts
import { Methods, Rossa, contentType, rateLimit, route, use } from "rossa";

const app = new Rossa();
app.use(rateLimit({ max: 60, windowMs: 60_000 }));

@route("/api")
@use(contentType("application/json"))
class Api extends Methods {
  get() {
    return Response.json({ ok: true });
  }
}
```

`app.use` prepends guards, so a guard registered later runs earlier. Place
wrapper guards such as `errorHandler` and `security` before the work whose
response they should wrap.

The public entry point exports guard factories for authentication
(`authBearer`, `apiKey`, `auth`, `authorize`), caching (`smartCache`), content
type, cookies, CORS, CSRF, error boundaries (`errorHandler`), headers, IP
filtering, JSON body validation, required JSON keys (`keys`), JWT (`jwtAuth`,
`jwtRefresh`), logging (`logger`, `loggerFN`), multipart and URL-encoded forms,
query and form validation, rate limiting, sanitization, security headers,
sessions, static files, timeouts, and URL validation. Define reusable custom
guards with `createGuard`. See [`doc/guards.md`](doc/guards.md) for guard
behavior and examples.

## Static files

Rossa recognizes common web, image, font, text, and JSON extensions by default.
Add extensions such as PDF or WebAssembly when creating the app:

```ts
const app = new Rossa({ fileExtensions: [".pdf", "wasm"] });
```

The `req.isFile` check recognizes these extensions. A catch-all route can then
call `res.fileServer()` to serve from `clientPath`:

```ts
@route("/:file")
class PublicFiles extends Methods {
  get({ req, res }: ctx): Promise<Response> | Response {
    if (req.isFile) return res.fileServer();
    return res.null(404);
  }
}
```

The static server checks resolved paths against the configured root (including
symlink resolution), caches small files, and supports ETags.

## WebSockets

Decorate a `Websocket` subclass with `@wss(path)` and register it with
`app.registerWSS`. Its `open`, `message`, `close`, and `drain` methods handle the
connection lifecycle. Guards on the WebSocket route can place verified identity
in `ctx.data`; Rossa copies that data to `this.contextData` before calling
`open`.

```ts
import { Rossa, Websocket, wss } from "rossa";
import type { wssMessage } from "rossa";

const app = new Rossa();

@wss("/chat")
class Chat extends Websocket {
  open() {}
  message(message: wssMessage) {
    this.send = JSON.stringify(message);
  }
  close(code: number, reason: string) {}
}

app.registerWSS(Chat);
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

`messageRateLimit` is optional and counts inbound messages independently for
each socket using a fixed time window. When a socket exceeds its limit, Rossa
closes it with code `1008`. `maxPayloadLength`, `backpressureLimit`, and
`closeOnBackpressureLimit` are Bun options. `drain()` runs after Bun drains
buffered outbound data.

`this.manager` is a per-connection `subManager` backed by the process-wide
`WSSMAN` singleton. Use it to subscribe to topics, broadcast, inspect members,
set admin flags, and configure room capacity or payload limits. Broadcast
results report each topic as `sent`, `backpressured`, `dropped`, or `oversize`.

For the handshake, frame parsing, lifecycle, and sample chat message contract,
see [`doc/websockets.md`](doc/websockets.md).

## MCP (Model Context Protocol)

Rossa can expose an MCP server over Streamable HTTP. Extend `McpController`,
declare tools, resources, and prompts in `build`, then register the decorated
class:

```ts
import { McpController, McpServer, Rossa, mcp } from "rossa";

const app = new Rossa();

@mcp("/mcp", { origin: "https://app.example.com" })
class Assistant extends McpController {
  build(server: McpServer) {
    server.registerTool(
      "echo",
      { description: "Echo a fixed value" },
      async () => ({ content: [{ type: "text", text: "ok" }] }),
    );
  }
}

app.registerMCP(Assistant);
```

For an explicit path without a controller class, pass a per-request factory:
`app.registerMCP("/mcp", (context) => new McpServer({ name: "raw", version: "1.0.0" }))`.

`origin` accepts full origins, bare hostnames, or `scheme://*`; requests without
an `Origin` header always pass. POST is served, GET and DELETE return `405`, and
OPTIONS/HEAD return `404`. Global `app.use(...)` guards run before the endpoint
and can block it, but header-only guards such as `cors()` do not decorate the
SDK's response; use `origin` or handle MCP CORS at a proxy.

See the [MCP chapter](doc/features.md#mcp-model-context-protocol) and the
[official TypeScript SDK docs](https://ts.sdk.modelcontextprotocol.io/v2/).

## Test requests without starting a server

`app.test(request)` runs a `Request` through the same router pipeline and
returns a `Response`. The runnable [`test.ts`](test.ts) shows HTTP, guards,
WebSockets, and this method.

```ts
const response = await app.test(
  new Request("http://localhost:3000/api", { method: "GET" }),
);
console.log(response.status, await response.text());
```

## Public exports

`src/index.ts` exports `Rossa` and its option types; `Methods`, `RouterManager`,
`route`, and `wss`; guard factories with `use` and `createGuard`; `ctx`, `Req`,
`Res`, and `sendError`; WebSocket classes and `WSSMAN`; MCP (`McpController`,
`McpServer`, `mcp`); authentication, database, and `Field`/`Scope` APIs. See
[`doc/features.md`](doc/features.md) for names.

## Documentation and examples

| Document                                                   | Contents                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| [`doc/features.md`](doc/features.md)                       | Complete feature and API reference.                        |
| [`doc/guards.md`](doc/guards.md)                           | Guard behavior, ordering, and custom guards.               |
| [`doc/websockets.md`](doc/websockets.md)                   | WebSocket client contract, lifecycle, and limits.          |
| [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/) | Official MCP server docs for tools, resources, and prompts. |
| [`doc/session-auth.md`](doc/session-auth.md)               | Session service implementation and login backend example.  |
| [`doc/db.md`](doc/db.md)                                   | Repository, schema, dialects, and schema synchronization.  |
| [`doc/field-scopes.md`](doc/field-scopes.md)               | Typed `Field` decorators and shared [`Scope`](doc/scopes.md) values. |
| [`doc/routing-style.md`](doc/routing-style.md)             | Route registration and matching model.                     |
| [`src/wss/examples/README.md`](src/wss/examples/README.md) | Group chat, direct message, and bot examples.              |

Run the sample with `bun run test.ts`.

## Load harness

Run the local WebSocket load harness with `bun run test:load`. It reports
fan-out delivery, latency percentiles, publish statuses, and RSS change.
Configure it with `BENCH_CLIENTS`, `BENCH_DURATION_SECONDS`,
`BENCH_MESSAGES_PER_SECOND`, `BENCH_DELIVERY_TIMEOUT_MS`, or
`BENCH_BACKPRESSURE_LIMIT`. It is a benchmark, not a capacity guarantee.
WebSocket rooms, rate-limit counters, and the small-file cache are process-local;
multi-instance deployments need shared pub/sub, membership state, and rate
limiting.
