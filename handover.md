# Rossa Project Handover

## What this project is

Rossa is a TypeScript web framework built on Bun. It provides decorator-based
HTTP and WebSocket routing, a guard pipeline, request and response helpers,
static file serving, server-sent events (SSE), and a small SQL repository layer.

The framework source lives in `src/`. `src/index.ts` is the public package entry
point. `README.md` is the quick-start guide; this document is intended to give a
maintainer a broader map of the implementation and its current test coverage.

## Runtime and development

- Runtime and test runner: Bun.
- Language: TypeScript, strict mode, ES modules.
- Local type-check command: `./node_modules/.bin/tsc --noEmit`.
- Test command: `bun test` (also exposed as `bun run test`).
- `builder.ts` is the repository's build entry point; `package.json` intentionally
  has no build script. The package exports `dist/index.js` and
  `dist/index.d.ts`. After source changes, run the builder the way the project
  currently does, then inspect the emitted `dist/` files and pack a clean
  consumer install before publishing. Do not add a package build script unless
  the maintainer asks to change that workflow.
- Dependencies include linked local packages `@ohmyqt/oven` and `@ohmyqt/u`,
  plus `reflect-metadata`; account for those when setting up a fresh checkout.

Run `./node_modules/.bin/tsc --noEmit` and the relevant `bun test` files after
changes. SSE helper tests need a live Bun server; this workspace's sandbox may
reject local socket binds with `EPERM`.

## Repository map

| Path                            | Responsibility                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/index.ts`                  | Public exports for the framework.                                                                 |
| `src/core/rossa.core.ts`        | `Rossa` construction, global guard execution, HTTP routing, WSS upgrade flow, Bun server startup. |
| `src/core/static-server.ts`     | Static file extension recognition, root and symlink containment checks, file cache, ETag support. |
| `src/router/`                   | Route decorators, HTTP method registration, path matching, class and method guards.               |
| `src/guard/`                    | Guard factories and shared IP/rate-limit helpers. See `doc/guards.md`.                            |
| `src/guard/form-data.util.ts`   | FormData conversion helper used by the multipart and URL-encoded guards.                          |
| `src/http/ctx/`                 | Request-scoped`ctx`, including route params, query/body/form state, session and guard data.       |
| `src/http/req/`                 | Request wrapper and lazy URL, query, cookie, body, file, and upgrade helpers.                     |
| `src/http/res/`                 | Response builder, compression, file/range responses, and SSE stream helpers.                      |
| `src/wss/`                      | WebSocket controller, lifecycle callbacks, shared topic manager, group chat example.              |
| `src/auth/`                     | Session primitives and JWT services/interfaces.                                                   |
| `src/db/`                       | SQL repository, schema/column definitions, dialects, and inspection helpers.                      |
| `examples/login/`               | SQLite-backed session and JWT registration/login backend examples.                                |
| `doc/`                          | Guard, field-scope, database, and session-auth documentation.                                     |
| `test/Methods/`                 | HTTP method dispatch and SSE event routing tests.                                                 |
| `src/services/scope.service.ts` | Typed`Field` scope decorator/proxy API.                                                           |
| `test/`                         | Guard, routing, request, static-file, transport, WebSocket security, and concurrency tests.       |
| `test.ts`                       | Runnable sample showing decorators and in-process`app.test()`.                                    |

## Main server flow

1. Create `new Rossa(options)` and register HTTP controllers with
   `app.register(...)`; register WebSocket controllers with `app.registerWSS(...)`.
2. `app.use(...)` adds global guards. The router runs these before route lookup.
3. On a live server, `Rossa.serve(serverOptions, websocketOptions)` calls
   `Bun.serve`. Its fetch handler creates `Req`, `Res`, and `ctx` objects and
   invokes the same pipeline used by `app.test(request)`.
4. After global guards, the router detects WebSocket upgrade requests first.
   Other requests are matched by HTTP method and path. A matching controller's
   method guards run before its handler.
5. Errors reaching the core boundary become a 500 response. Detailed logging
   there is controlled by the `logError` option; guard-specific error behavior
   may differ.

### Creating and registering a route

```ts
import { Methods, Rossa, route } from "./src/index";
import type { ctx } from "./src/index";

const app = new Rossa({ Encoding: "none" });

@route("/users/:id")
class Users extends Methods {
  get({ params, res }: ctx): Response {
    return res.json({ id: params.id });
  }
}

app.register(Users);
app.serve({ hostname: "127.0.0.1", port: 3000 });
```

Supported HTTP method names on `Methods` are `get`, `post`, `put`, `head`,
`delete`, `patch`, and `options`. Route parameters are strings in
`ctx.params`. Query values are available from `ctx.req.query`; the query
validation guard can place validated values in `ctx.query`.

Rossa supplies an inherited OPTIONS handler for each declared HTTP path. It
returns an empty 204 response with an `Allow` header built from the methods
registered for that path, including OPTIONS. OPTIONS to an undeclared path
still returns 404. CORS behavior is controlled separately by the CORS guard.

The `Rossa` options are `basePath`, `clientPath`, `dirPath`, `fileExtensions`,
`logError`, and `Encoding`. Relative `clientPath` is resolved relative to the
parent of `dirPath` (whose default is `./src`). `fileExtensions` adds to the
built-in extension set; it does not remove built-ins. Extension values may have
an optional leading dot.

## Guards and context

Guards are factories: configure a guard, then register the returned function.
Use `app.use(...)` for the global pipeline, or the `@use(...)` decorator on an
HTTP or WSS controller/method. `app.use` prepends guards, so later calls run
earlier. Ordering matters for wrappers such as error handling.

The framework exports guard factories for authentication, authorization,
cookie checks, CORS, CSRF, content types, headers, IP filtering, rate limits,
JSON and form validation, sanitization, security headers, sessions, static
files, timeouts, caching, logging, and URL/query validation. `cookies(name)`
checks that a named cookie exists; read its value with
`ctx.req.cookies.get(name)`. FormData conversion is an internal utility, while
`multipart()` and `urlencoded()` are the parsing guards. There is no
`requireSession` guard: `session(service)` creates an anonymous session when no
valid session cookie is present. Check an application identity (for example
`ctx.session.userID`) after the session guard to protect signed-in routes. See
`doc/guards.md` and `doc/session-auth.md`.

`ctx` provides:

- `req`: wrapped native `Request`, URL, cookies, auth token, query, body parser,
  IP, file detection, and upgrade helpers.
- `res`: response builder.
- `params`, `method`, and `methods`: route parameters, resolved method, and
  registered methods for the matched route.
- `data`, `jwtData`, `session`, `body`, `form`, and `query`: request-local values
  used by guards and handlers.

Prefer validation guards for untrusted bodies. The request wrapper caches text
and parsed JSON; its lower-level `json()` method returns an empty object when
parsing fails, so it should not be treated as validation by itself.

## Responses, files, and SSE

`ctx.res` supports chained status/header/encoding setup and response methods
including `json`, `html`, `text`, `null`, `success`, `error`, `redirect`,
`file`, and `fileServer`. `file()` handles Bun files and byte arrays; Bun files
support range responses. The static file server checks resolved paths against
the configured root, including symlink resolution, caches small files, and
supports ETags.

For SSE, GET clients should send `Accept: text/event-stream` with a positive
quality value; routing maps that request to the controller's `event` method.
Other HTTP methods keep normal dispatch even if they send that Accept header.
Return one of
`res.event.asyncStream(...)`, `res.event.eStream(...)`, or
`res.event.readableStream(...)`. `asyncStream` emits each yielded value as an
SSE `data` message; `eStream` supports event metadata and periodic pushes;
`readableStream` gives manual stream control. These helpers require a live Bun
server context to disable the request timeout. `app.test()` has no server
context, so it cannot fully exercise a live SSE connection.

The compression guard was removed. `Res` compresses according to its configured
encoding when the request accepts it; negotiation is implemented in
`src/http/res/res.compressor.ts`.

SSE is one-way. Use WebSockets for bidirectional messaging.

## WebSockets and chat example

Subclass `Websocket`, decorate with `@wss(path)`, then call `app.registerWSS`.
The lifecycle hooks are `open()`, `message({ text, json, topic })`, and
`close(code, reason)`. The `send` setter writes to the current socket. Guards
run before the upgrade; their `ctx.data` is copied to
`this.contextData` before `open()` runs.

`this.manager` is a per-connection `subManager` backed by the exported
process-wide `WSSMAN` singleton. It supports topic subscribe/unsubscribe,
broadcast, member lookup, admin flags, room capacity, payload size checks, and
disconnect cleanup. Broadcast results report each topic as `sent`,
`backpressured`, `dropped`, or `oversize`. A controller can implement `drain()`
to react when Bun has drained buffered outbound data. Bun's WebSocket options
are the second argument to `app.serve`; for example, `maxPayloadLength` limits
incoming WebSocket frames. Rossa also accepts `messageRateLimit: { max, windowMs }`, which applies an optional fixed-window limit independently per
connection and closes a connection that exceeds it with code 1008. Message
throttling is opt-in; no per-socket limit is applied by default.

The group chat sample is in `src/wss/examples/group-chat.ts` with setup notes in
`src/wss/examples/README.md`. Its `createGroupChatController(store, limits?)`
accepts optional per-example message-length, room-capacity, and broadcast-size
limits. Supply a `GroupChatStore` adapter that:

1. Resolves a session cookie to a user.
2. Checks that user is a member of a conversation before joining.
3. Rechecks membership before sending each message.
4. Persists a message before broadcasting it to the conversation topic.

Direct messages and group chats can both be modeled as conversations with
different member lists. The sample uses a private topic per conversation,
limits message length, room connection count, and published payload bytes. It
does not persist history or deliver messages to offline users; use an HTTP
history endpoint and a database-backed delivery strategy for those needs.

## Authentication, deployment, and production limits

The framework provides authentication and session building blocks, but the
application owns identity, token/session persistence, account policy, and
conversation membership. Always authorize a user before subscribing a socket
to a private topic and before accepting a private message. The manager's admin
flags and topic subscriptions do not independently enforce an application ACL.

Current limits to account for:

- `WSSMAN`, room membership, rate-limit counters, and the small-file cache are
  in-memory and process-local. They are not shared across worker processes or
  machines. A multi-instance chat deployment needs a shared pub/sub layer and
  shared persistent membership/message state.
- `WssConfig.maxPayloadSize` is applied to manager broadcasts by topic; it is
  not a per-connection inbound message limit. Configure Bun's
  `maxPayloadLength` in the second `serve` argument for incoming frame limits.
- The HTTP `rateLimit` guard is process-local and keyed by IP, method, and path.
  WebSocket message rate limiting is opt-in through `messageRateLimit`; it is
  fixed-window and process-local. Configure and test it for each application.
- The manager's default room `maxClients` is unlimited; configure a cap for
  rooms that need one. The manager only manages subscriptions and broadcasts;
  it does not decide whether a conversation ID is authorized.
- Configure production TLS with Bun's `tls` options passed to `app.serve`.
  Keep private keys in deployment secrets, use a trusted certificate chain,
  and verify renewal and hostname configuration in the actual hosting
  environment. The test certificate is self-signed and only for local tests.
- `bun run test:load` runs a configurable local WebSocket fan-out workload and
  reports delivery, latency, publish statuses, and process RSS change. It is a
  benchmark harness, not a capacity guarantee; run it at representative rates
  and durations in staging. It does not replace fuzzing or a security audit.
- Review forwarded IP/proxy handling for the production topology before
  relying on IP allowlists or rate limits behind a reverse proxy.
- Check session cookie options (Secure, HttpOnly, SameSite, expiry and rotation)
  in the application adapter; the framework cannot infer the desired policy.
- `examples/login/` contains runnable SQLite session and JWT login backends.
  Session mutations such as `(ctx.session as any).userID = user.id` are saved by
  `session(service)` after the handler returns; the service's `saveSession()`
  is the persistence hook. See `doc/session-auth.md` before adapting the
  example for production.

## Test inventory

`bun test` includes these project checks:

| Test location             | Coverage                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/Auth/`              | Bearer token, API key, headers, session policy and JWT refresh behavior.                                                                                                                          |
| `test/Cors & Headers/`    | CORS, media type/header checks, and security headers.                                                                                                                                             |
| `test/Request & Payload/` | JSON/query/form validation, parsing, sanitization, cookies, static files, HEAD and symlink containment.                                                                                           |
| `test/Routing/`           | Path-scoped default OPTIONS response and`Allow` header.                                                                                                                                           |
| `test/Security/`          | CSRF, IP policy, HTTP rate limits, cache behavior, logging, URL validation, errors and timeouts.                                                                                                  |
| `test/Smoketest/`         | HTTP routing, base paths, global guards, handler errors, local HTTPS using a trusted test CA, and WebSocket upgrade/room broadcast.                                                               |
| `test/Methods/`           | GET, POST, PUT, HEAD, DELETE, PATCH, inherited OPTIONS, event routing, and the three `res.event` SSE helpers.                                                                                     |
| `test/WSS Security/`      | WSS handshake authorization, frame/message rate limits, repeated connection cleanup, backpressure status mapping, plus group chat membership, revocation, room capacity and persistence failures. |
| `test/Load & TLS/`        | 64 concurrent HTTP requests and response/parameter isolation.                                                                                                                                     |
| `test/load/benchmark.ts`  | Configurable WebSocket fan-out load/soak harness with delivery, latency, memory, and publish status metrics.                                                                                      |
| `test/DB/`                | SQLite repository operations, dialect behavior, and schema synchronization.                                                                                                                       |

Local HTTPS, WebSocket, and SSE helper tests bind sockets, so the test process
needs permission to listen on `127.0.0.1`. `tsc --noEmit` checks the project
and test types without starting servers.

## Remaining work

1. Run the load harness against staging and record workload parameters and
   output. `BENCH_URL` must point to a WebSocket route that accepts each JSON
   message and broadcasts it to all other clients in the same room. For example:

   ```sh
   BENCH_URL=wss://staging.example/benchmark \
   BENCH_CLIENTS=200 BENCH_DURATION_SECONDS=60 \
   BENCH_MESSAGES_PER_SECOND=250 bun run test:load
   ```

   External runs report client delivery and latency; server-side publish status
   counters are only available for local runs.

2. For a multi-instance production deployment, use a shared SQL database for
   users and persisted sessions/refresh tokens, a shared store such as Redis for
   rate-limit counters, and a pub/sub layer such as Redis Pub/Sub for WSS room
   fan-out. The current in-memory rate limiter and `WSSMAN` do not synchronize
   between processes. This is a recommended baseline; confirm the actual
   provider choice against the deployment environment before implementing an
   adapter.
3. Validate TLS at the deployed endpoint, including hostname, complete
   certificate chain, renewal, proxy termination, and HTTP-to-HTTPS policy.
   This requires the staging/production hostname and access to its endpoint.

The build workflow is maintained in `builder.ts`; the package intentionally
has no `build` script. The maintainer reports having compiled the current
artifact to `dist/`. Before publishing a later change, run the existing builder,
inspect the emitted files, and verify a packed install from a clean Bun
consumer. Do not add a package script as part of this maintenance task.

## Small examples

### Run an in-process request

```ts
const response = await app.test(
  new Request("http://localhost/users/42", { method: "GET" }),
);
console.log(response.status, await response.text());
```

### Start HTTP with TLS and WSS limits

```ts
app.serve(
  {
    hostname: "0.0.0.0",
    port: 3000,
    tls: {
      cert: Bun.file(process.env.TLS_CERT_PATH!),
      key: Bun.file(process.env.TLS_KEY_PATH!),
    },
  },
  {
    maxPayloadLength: 64 * 1024,
    idleTimeout: 60,
  },
);
```

Read certificate paths from a deployment secret/configuration system; do not
commit production private keys.
