# Rossa

Rossa is a Bun HTTP server with decorator-based routing, request guards, a
response/context API, and optional WebSocket routes.

For browser-side data storage, see the standalone [IndexedDB helper](indexeddb/README.md)
outside `src`, with schema/column builders and typed CRUD operations.

## Install and build

Rossa requires Bun. In an application, install the published package and import
its public API from `rossa`:

```sh
bun add rossa
```

The package build bundles the runtime entry point for Bun and emits TypeScript
declarations under `dist/`. Run `bun run build` before packing or publishing;
`bun pm pack --dry-run` previews the files included in the package.

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

`Rossa` accepts these options:

| Option           | Default      | Purpose                                                                                                   |
| ---------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| `basePath`       | `""`         | Prefix added to registered HTTP and WebSocket routes.                                                     |
| `clientPath`     | `"./public"` | Directory used by `res.fileServer()`.                                                                     |
| `dirPath`        | `"./src"`    | Anchor used to resolve a relative `clientPath`.                                                           |
| `fileExtensions` | `[]`         | Additional extensions to recognize, with or without a leading dot. Built-in extensions remain recognized. |
| `logError`       | `false`      | Log errors caught by the router pipeline.                                                                 |
| `Encoding`       | `"br"`       | Response encoding; supports the `ContentEncodingType` values.                                             |

`app.serve(serverOptions, websocketOptions)` starts Bun's server. The first
argument accepts Bun serve options plus an optional `fn(port)` callback. The
second argument accepts Bun WebSocket options. If no port is provided, Rossa
uses `3000`.

## Static files

Rossa recognizes common web, image, font, text, and JSON extensions by
default. Add extensions such as PDF or WebAssembly when creating the app:

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

Useful response methods include `text`, `html`, `json`, `success`, `error`,
`redirect`, `null`, and `fileServer`. Route parameters are exposed as strings
on `ctx.params`; query parameters are available from `ctx.req.query`.

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

The public entry point exports guard factories for authentication, caching,
compression, content type, cookies, CORS, CSRF, errors, forms, headers, IP
filtering, JSON, JWT, logging, multipart, query validation, rate limiting,
sanitization, security headers, sessions, static files, timeouts, and URL
validation. See [`doc/guards.md`](doc/guards.md) for guard behavior and
examples.

## WebSockets

Decorate a `Websocket` subclass with `@wss(path)` and register it with
`app.registerWSS`. Its `open`, `message`, and `close` methods handle the
connection lifecycle. Guards on the WebSocket route can place verified
identity in `ctx.data`; Rossa copies that data to `this.contextData` before
calling `open`.

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
`closeOnBackpressureLimit` are Bun WebSocket options. A controller may implement
`drain()` to resume work after Bun drains buffered outbound data. Topic
`manager.broadcast(...)` returns per-topic statuses (`sent`, `backpressured`,
`dropped`, or `oversize`) so handlers can observe publish outcomes.

For the handshake, frame parsing, lifecycle, and sample chat message contract,
see [`doc/websockets.md`](doc/websockets.md).

## Test requests without starting a server

`app.test(request)` runs a `Request` through the same router pipeline and
returns a `Response`. The runnable example in [`test.ts`](test.ts) shows HTTP,
guards, WebSockets, and this in-process request method.

```ts
const response = await app.test(
  new Request("http://localhost:3000/api", { method: "GET" }),
);
console.log(response.status, await response.text());
```

## Public exports

`src/index.ts` is the package entry point. It exports:

- `Rossa` and its `RossaOptions`, `serverOptions`, and `dev` types.
- `ContentEncodingType` for the supported response encodings.
- `Methods`, `RouterManager`, `route`, `wss`, and router metadata types.
- `use`, `createGuard`, guard factories, and guard-related types.
- `ctx`, `Req`, `Res`, and response error types.
- `Websocket`, `wssMessage`, `WssConfig`, `WssManager`, `subManager`, and the
  default `WSSMAN` singleton.
- `Field` for typed field scopes. See [`doc/field-scopes.md`](doc/field-scopes.md)
  for a route example.

Run the sample with `bun run test.ts`.

For a group chat built on per-conversation topics, session authentication,
membership checks, and a persistence adapter, see
[`src/wss/examples/README.md`](src/wss/examples/README.md).

## Load harness

Run the repeatable local WebSocket load harness with `bun run test:load`. It
reports fan-out delivery ratio, latency percentiles, publish statuses, and RSS
memory change. Set `BENCH_CLIENTS`, `BENCH_DURATION_SECONDS`,
`BENCH_MESSAGES_PER_SECOND`, `BENCH_DELIVERY_TIMEOUT_MS`, or
`BENCH_BACKPRESSURE_LIMIT` to adjust the workload. Use a staging environment
and representative deployment limits before drawing production capacity
conclusions.
