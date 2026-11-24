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

`serverOptions` accepts Bun serve options plus an optional `fn(port, server)`
ready callback. It runs after Bun binds the socket, so `port` is the port
actually in use — with `port: 0` that is the OS-assigned port — and the second
argument is the bound `Bun.Server`. Without `fn`, the startup log prints the
bound URL (`server.url`), including `https` when `tls` is set.

**Behavior change:** the callback now receives the bound endpoint rather than
the configured port, and the log shows the bound URL instead of a hard-coded
`localhost`. Existing `(port) => …` callbacks keep working.

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
methods registered for that path, including OPTIONS. Override `options` to
customize the response.

| Request | Result |
| --- | --- |
| OPTIONS on a declared path | `204`, empty body, `Allow: <declared methods + OPTIONS>` |
| OPTIONS on an undeclared path | `404` |
| HEAD with a `head` handler | That handler's response; HTTP suppresses the body |
| HEAD without a `head` handler | `404` — there is no automatic GET fallback |
| Any method with no handler on a declared path | `404` |

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
| `json(schema)`              | Checks content type and a 1 MiB default limit on POST/PUT/PATCH, parses JSON, validates it, and stores it in both `ctx.body` and `ctx.req._json`. |
| `keys(names)`               | Parses JSON, checks required top-level keys, then stores the body in `ctx.body`. Does not validate field types.       |
| `multipart()`               | Parses `multipart/form-data` into `ctx.form`. Uploads stay `File` objects with their declared MIME type; repeated names become arrays. Bodies default to a 1 MiB cap (`{ maxSize }`). |
| `urlencoded()`              | Parses `application/x-www-form-urlencoded` into `ctx.form`; repeated names become arrays. `{ strict: true }` rejects malformed percent escapes and NUL bytes. Bodies default to a 1 MiB cap (`{ maxSize }`). |
| `validateQuery(schema)`     | Coerces and validates query values into `ctx.query`. Duplicate names keep the last value.                             |
| `validateForm(schema)`      | Parses and validates form values into `ctx.form`. Duplicate names keep the last value.                                |
| `validateUrl(options?)`     | Checks URL and query length, duplicate or disallowed keys, value patterns, malformed escapes, null bytes, and traversal in the pathname and decoded query string. |
| `contentType(rule)`         | Accepts a MIME type, a list, or a sync predicate. Parameters such as `charset` are ignored.                            |
| `cors(options)`             | Applies CORS headers and validates origins. Supports `origin`, `allowHeaders`, `exposeHeaders`, `credentials`, and `maxAge`. |
| `csrf(options?)`            | Compares a request token with the `csrf_token` cookie on POST, PUT, PATCH, and DELETE. Header mode (default) reads `x-csrf-token`; `{ mode: "double-submit" }` reads a JSON/form body field (default `csrf_token`). `csrf.issue(ctx, options?)` / `csrf.token(ctx)` mint the token. |
| `header(rules)`             | Requires header names or validates them with a map of synchronous checks.                                             |
| `ipFilter(options)`         | Applies `whitelist` and `blacklist` rules for IPv4 addresses, wildcard patterns, and CIDR ranges.                     |
| `rateLimit(options?)`       | In-memory fixed-window request limit keyed by IP, method, and path. Defaults: 100 requests per 60 seconds.            |
| `sanitize(options?)`        | Escapes HTML-sensitive characters in parsed query, form, body, and JSON values.                                       |
| `security(options?)`        | Adds `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY` by default. CSP, HSTS, and the other policies are opt-in. |
| `jwtAuth(service)`          | Verifies an access token and stores claims in `ctx.jwtData`; rejections are `401` with `WWW-Authenticate: Bearer`.    |
| `jwtRefresh(service)`       | Reads `x-refresh-token`, claims it once, issues a replacement pair in `ctx.data.jwtTokens`, and stores refresh claims in `ctx.data.jwtRefreshData`. Mount after `jwtAuth`. |
| `jwtRotate(service)`        | Verifies an access token when present, then claims the refresh token and issues a replacement pair. Use alone for a rotation endpoint. |
| `session(service)`          | Loads `ctx.session`, runs downstream work, then persists or deletes changes. Accepts `{ auth, readonly }` and a typed data parameter; creates an anonymous session when none exists. |
| `smartCache({ ttlMs })`     | In-memory GET response cache keyed by full URL. Requests with cookies, authorization, or range headers bypass it. Use only for public responses. |
| `staticFiles()`             | Serves GET and HEAD requests for recognized file paths through the static file server.                               |
| `logger(label?)`            | Logs method, path, and timestamp before downstream work.                                                             |
| `loggerFN(formatter)`       | Calls a formatter after downstream work and logs a truthy result.                                                     |
| `timeout(milliseconds)`     | Stops waiting after the limit and returns `408`. It cannot cancel work already running.                               |
| `errorHandler(options?)`    | Catches thrown errors from downstream guards and handlers; returns a plain-text `500` `Internal Server Error` unless `message` or `onError` is supplied. |

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

The per-use second argument can override any error field, including `code`,
`message`, `headers`, or `redirect`. Omitted fields keep the factory default;
`code` finally falls back to `400`, and `headers` are shallow-merged.

**Behavior change:** a per-call `code` now wins over the factory default
(`requireTenant(options, { code: 451 })` answers `451`). Before this, the status
always came from the `createGuard` defaults, and `BaseConfig` did not accept
`code`.

### Rejection shapes

`sendError(config)` returns `application/json` with `{ success: false, error }`
and only the headers supplied in `config.headers`, plus `Content-Type` and
`Location` where applicable. **Behavior change:** it no longer adds
`Access-Control-Allow-Origin: *`; every guard rejection used to advertise a
wildcard CORS grant. The `cors` guard owns CORS now — mount it before the guards
whose rejections a browser must read, or pass an explicit
`Access-Control-Allow-Origin` header for one response.

The `errorHandler()` guard returns a plain-text `500` (`text/plain;
charset=utf-8`, body `Internal Server Error`) rather than JSON; without the
guard, the core pipeline boundary returns an empty `500`. See
[`doc/guards.md`](guards.md#rejection-and-framework-response-shapes) for the
stable OPTIONS/HEAD matrix and the default `security()` header set.

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
| `jwtData`         | Access claims populated by JWT guards; refresh claims live in `data.jwtRefreshData`.          |
| `session`         | Session proxy populated by `session(service)`; type it with `SessionContext<TData>`.         |
| `body`            | Parsed body populated by `keys(names)` and `json(schema)`; also mirrored to `req._json`.     |
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
| `autoBody<T>(options?)`    | Content-type-aware body: JSON for `application/json` (and `+json`), `FormData` for form content types, raw text otherwise, `null` for an empty body. Cached, capped at 1 MiB by default (`{ maxSize }`), and malformed JSON falls back to `"text"`. |
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

`req.autoBody<T>()` returns `{ body, parsedWith }`, where `parsedWith` is
`"json" | "form" | "text" | "empty"`. Use it on lenient endpoints that accept
either shape:

```ts
const { body, parsedWith } = await req.autoBody();
// parsedWith === "json" → body is the parsed value
// parsedWith === "form" → body is FormData
// parsedWith === "empty" → body is null
```

There is no separate `files` helper. Use `req.form()` or the `multipart()` guard
to read uploads; uploaded entries remain `File` objects.

### `Res`

`res` keeps status, headers, and encoding state for the current response. Most
methods return a standard `Response`.

| Member                     | Description                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `status(code)`             | Set the response status. Returns `res` for chaining.                                         |
| `header(input)`            | Add or replace headers. `Vary` values are merged.                                             |
| `setCookie(name, value, options?)` | Append one `Set-Cookie` header; multiple calls are preserved. Reuses `CookieOptions` and value sanitization, and defaults `Path=/`. |
| `clearCookie(name, options?)` | Expire a cookie: empty value, `Max-Age=0`, and an epoch `Expires`.                          |
| `encode(type)`             | Set or clear the response content encoding.                                                  |
| `null(status?)`            | Empty response with the given or current status.                                             |
| `json(value)`              | `application/json` response.                                                                 |
| `html(body)`               | `text/html; charset=utf-8` response.                                                         |
| `text(body?)`              | `text/plain; charset=utf-8` response.                                                        |
| `success(code?, data?, message?)` | JSON `{ success: true, ... }` response.                                               |
| `error(code, message)`     | Error response; records become JSON, strings become `text/plain`.                            |
| `redirect(url, status?)`   | Safe-by-default redirect to an origin-relative target; unsafe targets answer `400` (see below). |
| `redirectLocal(url, status?)` | Alias of `redirect`, kept for `0.1.3` callers; same origin-relative validation.            |
| `redirectExternal(url, status?)` | Redirect to an absolute `http:`/`https:` URL only; other targets answer `400`.          |
| `file(file, meta?, headers?)` | Send a Bun file or `Uint8Array`; `FileMeta` sets `size`, `type`, buffer `ranges`, and `etag`/`lastModified` validators. Bun files always support byte ranges; buffers opt in with `ranges: true`. |
| `fileServer()`             | Serve the current request through the configured static file server.                          |

#### Response cookies

`res.setCookie()` writes cookies directly to the response and keeps every
`Set-Cookie` header separate, so one response can set several cookies:

```ts
return res
  .setCookie("csrf_token", token, { path: "/", httpOnly: false, sameSite: "Lax" })
  .setCookie("theme", "dark", { path: "/", maxAge: 60 * 60 * 24 * 365 })
  .json({ success: true });
```

`clearCookie(name)` is the matching expiry: it sends an empty value with
`Max-Age=0` and an epoch `Expires`. Both accept the exported `CookieOptions`
(`path`, `domain`, `httpOnly`, `secure`, `sameSite`, `maxAge`, `expires`) and
strip control characters from names and values.

#### Redirect targets

Redirects are safe by default. `redirect()` accepts only origin-relative
destinations, so a handler can forward request input directly:

```ts
import { isLocalRedirectTarget, type ctx } from "rossa";

get({ req, res }: ctx) {
  const next = String(req.query.next ?? "/");
  return res.redirect(next); // 302 /dashboard, or 400 for an off-origin target
}

// Validate first when you need a custom rejection.
if (!isLocalRedirectTarget(next)) return res.error(400, "Bad next");
return res.redirect(next);
```

`redirect()` rejects anything that could leave the current origin and answers
`400` with `{"success":false,"error":"Invalid redirect target"}` (no
`Location`):

- absolute and protocol-relative targets (`https://evil.test`, `//evil.test`);
- backslash and scheme forms (`\\evil.test`, `javascript:`, `data:`);
- encoded authorities such as `/%2f%2fevil.test` or `/%252f%252fevil.test`
  (percent-decoded up to three passes before validation);
- control characters, empty, and whitespace-only values.

Rooted paths are emitted unchanged (`/account?id=1&tab=prefs`). Safe bare
relatives are normalized for you: `dashboard` becomes `/dashboard` and `?q=1`
becomes `/?q=1`. The same normalization backs the exported
`isLocalRedirectTarget()`, so branching code agrees with the guard.
`redirectLocal()` is an alias of `redirect()` kept for `0.1.3` callers.

For a deliberate off-origin hop (OAuth authorize URLs, payment providers), say
so explicitly with `redirectExternal()`. It allows only absolute `http:` or
`https:` URLs and passes them to `Location` unchanged; protocol-relative,
scheme (`javascript:`, `data:`), backslash, and relative targets — including
local paths — still answer the same `400`:

```ts
return res.redirectExternal(
  "https://accounts.example.com/oauth/authorize?client_id=app",
);
```

CR/LF/NUL and other control characters are stripped from every `Location`
value on the way out, so a redirect response can never inject additional
headers.

#### File responses

`res.file(file, meta?, headers?)` sends a Bun file or a `Uint8Array`.

- Bun files always support byte ranges. A `Uint8Array` opts in with
  `meta.ranges: true`; without it buffers advertise `Accept-Ranges: none` and
  ignore `Range`.
- A satisfiable `Range` answers `206` with `Content-Range` and an exact
  `Content-Length`. Slices are always identity-encoded: the response carries no
  `Content-Encoding`, even when the full response would negotiate one. The
  `bytes` unit is matched case-insensitively.
- A comma-separated multi-range header such as `bytes=0-1,5-6` serves the first
  satisfiable entry as a normal single-part `206`; Rossa never emits
  `multipart/byteranges`. Entries that cannot be served are skipped, so `416`
  is returned only when nothing in the header is satisfiable.
- A `416` keeps `Content-Type`, `Accept-Ranges`, and
  `Content-Range: bytes */<size>`.
- A missing Bun file answers the framework JSON envelope
  `{"success":false,"error":"File Not Found"}` with status `404`.
- Full responses whose body depends on `Accept-Encoding` carry
  `Vary: Accept-Encoding`; `206` slices are fixed and do not add it.

`meta` fields:

| Field          | Behavior                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `size`         | Byte length of a raw `Uint8Array`; honored only when it is a non-negative safe integer equal to the buffer's actual length. |
| `type`         | MIME type of a raw `Uint8Array`; defaults to `application/octet-stream`.                                        |
| `ranges`       | `true` enables byte ranges for a `Uint8Array` with the same single-range behavior as a Bun file.               |
| `etag`         | Entity tag emitted as `ETag` and used for conditional requests.                                                 |
| `lastModified` | Last modification time in epoch milliseconds, emitted as `Last-Modified`.                                       |

Validators are opt-in, so omitting them leaves the response unchanged. When
present they enable conditional GET:

- `If-None-Match` (with `*`, comma-separated lists, and weak comparison) is
  evaluated before range handling, so a match returns `304` even when the
  request also asks for a byte range.
- `If-Modified-Since` is honored only when `If-None-Match` cannot decide — the
  header is absent or the file has no `etag` — so a failed ETag comparison is
  not overridden by the date.
- `If-Range` accepts an entity tag (weak comparison) or an HTTP date. A match
  continues the `206`; a mismatch serves the full `200`; a validator the file
  does not expose is ignored.

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

SSE responses are always identity-encoded: the helpers remove any
`Content-Encoding` the builder negotiated, because the frames are written as
plain text. `res.event.*` therefore works with Bun `fetch`, `EventSource`, and
browsers without sending `Accept-Encoding: identity` or constructing the app
with `{ Encoding: "none" }`. Other (non-SSE) responses keep normal content
negotiation.

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

  onClose(code: number, reason: string) {}
}

app.registerWSS(Chat);
```

### Lifecycle

| Hook                        | When it runs                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `open()`                    | After a successful upgrade.                                                                  |
| `message({ text, json, topic })` | On each inbound frame. Valid JSON populates `json`; non-JSON text populates `text`.      |
| `drain()`                   | When Bun has drained buffered outbound data.                                                  |
| `onClose(code, reason)`     | When the connection closes, before `manager.cleanup()`.                                      |
| `capacityTopics(ctx)`       | Before the upgrade, to declare topics whose capacity should be checked.                       |

`onClose()` is a notification hook: subscriptions, topics, and admin flags are
still readable when it runs. It is not a close path. Use
`this.terminate(code = 1000, reason = "")` (or `this.ws.close(...)`) to close
from application code; Bun then reports the close, so `onClose()` runs before
cleanup.

> **Migration:** `Websocket.close(code, reason)` is the former lifecycle hook
> and is now a deprecated alias for `onClose()`. It still runs when a subclass
> overrides `close()` without overriding `onClose()`, and Rossa warns once per
> class. Move those overrides to `onClose()`.

`this.send = value` sends a string or byte buffer to the current socket.
`this.ws` is the native Bun `ServerWebSocket<WssSocketData>`, so `this.ws.data`
is typed (`{ id, nickname?, contextData?, instance? }`). `this.manager` is a
per-connection `subManager`. Values that guards put in `ctx.data` before the
upgrade are copied to `this.contextData` before `open()`.

`Websocket<TData, TIdentity>` exposes the guard identity and the handshake query
with types instead of casts:

```ts
interface ChatIdentity {
  nickname: string;
  id?: string;
}

@wss("/chat")
class Chat extends Websocket<{ seen: number }, ChatIdentity> {
  open() {
    const nickname = this.user.nickname; // from ctx.data.user/chatUser/principal
    const room = this.query.get("room") ?? "lobby";
    this.data.seen = 0;
    this.manager.subscribe(room);
  }
}
```

`this.user` resolves `contextData.user` → `contextData.chatUser` →
`contextData.principal` → `ws.data.user`, and defaults to `{}` when no guard
attached an identity. `TIdentity` defaults to `Record<string, any>`, so existing
untyped subclasses keep compiling. `this.query` is the handshake URL's
`URLSearchParams`; it is captured by the default `capacityTopics(ctx)`
implementation, so an override should call `super.capacityTopics(ctx)` to keep
it populated (the router has no other pre-upgrade hook to pass it through).

If a JSON frame has a top-level string `topic`, Rossa exposes it as `topic` and
removes it from `json`. This does not automatically subscribe or route the
message.

### Pre-handshake capacity

`maxClients` is normally enforced when `subscribe()` runs inside `open()`: an
unhandled throw there leaves a connected socket that cannot join. Override
`capacityTopics(ctx)` to let Rossa check capacity before the upgrade:

```ts
@wss("/rooms/:id")
class Room extends Websocket {
  capacityTopics(ctx: ctx) {
    return [`room:${ctx.params.id}`];
  }

  open() {
    this.manager.subscribe(`room:${this.contextData.roomId}`);
  }
}
```

When a declared topic is already at `maxClients`, the upgrade is answered with
`503 Service Unavailable` and no WebSocket is opened. Guards have run, so
`ctx.data` (auth/session/room selection) is available; `this.ws` and
`this.manager` are not. Set the topic's `maxClients` before the upgrade (module
scope, a guard, or `WSSMAN.setTopicConfig`). Return `[]` (the default) for
topics only known after the handshake; `subscribe()` then keeps its late-join
throw as before. The default implementation also snapshots the handshake query
into `this.query`; if you override `capacityTopics`, call
`super.capacityTopics(ctx)` when you rely on `this.query`.

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

// Also deliver the frame to the publishing socket:
this.manager.broadcast(["room-1"], { type: "message" }, { includeSelf: true });
```

| `subManager` method              | Purpose                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `subscribe(topic)`               | Subscribe the current socket. Throws when the room is full or closed.      |
| `unsubscribe(topic)`             | Leave a topic.                                                             |
| `isSubscribed(topic)`            | Check the current socket's membership.                                     |
| `broadcast(topics, data, options?)` | Publish to unique topics; returns per-topic publish results. `{ includeSelf: true }` also sends one copy to the publishing socket. |
| `members(topic)`                 | Typed `TopicMember[]` for a topic: `{ id, nickname, userId? }`.            |
| `setAdmin(topic)` / `isAdmin(topic)` | Track and query room admin flags.                                      |
| `setTopicConfig(topic, config)`  | Set `maxClients`, `maxPayloadSize`, `presence`, and `history` for a topic. |
| `cleanup()` / `unregister()`     | Remove the connection and its topic memberships.                           |

`WSSMAN` additionally exposes `getMemberDetails(topic)`, `getUserTopics(id)`,
`members(topic)`, and `get(topic)`. `WssConfig` supports:

| Option           | Default    | Meaning                                                                    |
| ---------------- | ---------- | -------------------------------------------------------------------------- |
| `maxClients`     | `Infinity` | Maximum members in a topic.                                                |
| `maxPayloadSize` | `65536`    | Maximum broadcast payload bytes for the topic.                             |
| `presence`       | off        | Emit automatic join/leave frames. `true` or `{ join?, leave? }`.           |
| `history`        | off        | Persist and replay accepted frames through a `TopicHistoryStore`.          |

`broadcast()` JSON-stringifies non-string values. Each result status is one of:

| Status          | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| `sent`          | Bun accepted the publish.                                        |
| `backpressured` | Bun reported `-1`; the socket has buffered data (Bun-only).      |
| `dropped`       | Bun reported `0`; the message was not delivered.                 |
| `oversize`      | The payload exceeded the topic's `maxPayloadSize`.               |

`backpressured` maps Bun's `ws.publish()` returning `-1`, which needs a peer
past Bun's outbound drain threshold. Application code cannot force it —
in-process peers always read — so it is not a testable manager result. Observe
backpressure through `ws.send()`/`drain()` or Bun's `backpressureLimit`; treat
`backpressured` as a pass-through status, not an app branch.

#### Presence events

Opt in per topic. Rossa then emits ordinary broadcast frames
`{ type: "join" | "leave", topic, member, members }`, where `member` is the
socket that joined or left and `members` is the post-change roster
(`TopicMember[]`, each `{ id, nickname, userId? }`):

```ts
this.manager.setTopicConfig("lobby", { presence: true });
// or suppress one side: { presence: { leave: false } }

this.manager.members("lobby"); // TopicMember[]: [{ id: "…", nickname: "rosa" }]
```

Join frames reach the joining socket as well as the existing members; leave
frames reach the remaining members after removal. `presence: true` enables both
events and `{ join?, leave? }` defaults each enabled key to `true`. A topic
without `presence` emits no extra frames, so existing protocols are unchanged.
Presence frames are never persisted. The frame type is exported as
`TopicPresenceFrame` and the member type as `TopicMember`.

#### History and replay

`WssHistoryConfig` plugs a `TopicHistoryStore` (`save(topic, frame)` /
`recent(topic, limit)`) into a topic:

```ts
import type { TopicHistoryStore } from "rossa";

const store: TopicHistoryStore = {
  async save(topic, frame) {
    await db`INSERT INTO messages (topic, payload) VALUES (${topic}, ${JSON.stringify(frame)})`;
  },
  async recent(topic, limit) {
    const rows = await db`SELECT payload FROM messages WHERE topic = ${topic} ORDER BY id DESC LIMIT ${limit}`;
    return rows.map((row) => JSON.parse(row.payload)).reverse(); // oldest → newest
  },
};

this.manager.setTopicConfig("lobby", {
  history: { store, limit: 50 },
});
```

Contract and defaults:

- Frames are handed to `save()` exactly as passed to `broadcast()` — an object
  or a string, with no marker injected. The frame shape stays application-owned.
- Saves run in broadcast order per topic, and a joining socket's replay first
  awaits pending saves, so it never misses a just-accepted frame.
- `recent(topic, limit)` must return oldest → newest; Rossa sends each entry as
  its own frame, in that order, when a socket joins.
- `limit` defaults to `DEFAULT_TOPIC_HISTORY_LIMIT` (`50`); non-positive or
  non-integer values fall back to it.
- `replay: false` persists without replaying. `persist(frame)` filters what is
  stored; returning `false` skips the frame.
- Only accepted frames are persisted: oversize payloads are skipped, and
  presence or replayed frames are never written back.

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
- Bare hostnames such as `app.example.com`, matched port-agnostically in either
  scheme.
- Scheme wildcards. `"https://*"` allows any https origin and rejects http;
  `"http://*"` is the inverse; `"moz-extension://*"` and other non-web schemes
  keep the SDK's extension-wildcard behavior.

Rossa validates `http`/`https` scheme wildcards itself before delegating to the
SDK, whose wildcard rule covers only non-web schemes. That makes
`"https://*"`/`"http://*"` mean "any origin of that scheme, on any host and
port". Lists may mix wildcards, exact origins, and hostnames.

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
cookie, `session(service)` creates an anonymous session. Compose the official
`requireSession()` guard after it to require a store-verified session on
protected routes:

```ts
@use(session(sessions), requireSession())
class AccountController {}
```

Anonymous, forged, unknown-ID, and expired sessions get `401`; an optional
validator adds an identity check, for example
`requireSession((s) => typeof (s as any).userID === "number")`.

`session()` accepts either the service or a mount object. A readonly mount
loads the session read-only, discards writes, and skips persistence:

```ts
app.use(session({ auth: sessions, readonly: true }));
```

Pass the stored data shape as a type parameter and annotate handlers with
`SessionContext<TData>` to read it without casts:

```ts
interface AccountSession {
  userId: string;
}

app.use(session<AccountSession>(sessions));

@route("/profile")
class Profile extends Methods {
  get(ctx: SessionContext<AccountSession>) {
    return ctx.res.json({ userId: ctx.session?.userId });
  }
}
```

Call `await ctx.session!.rotate()` after a successful login to re-key the
session. The previous row is deleted and a new signed `sid` is minted
immediately; the guard persists the new row and cookie after the handler
returns, so rotate on the success path only. A readonly mount ignores rotation
with a warning.

For login and logout, `reset()` and `clear()` combine rotation with data
replacement:

```ts
await ctx.session!.reset({ userId: user.id }); // login
await ctx.session!.clear(); // logout
```

`reset(data)` rotates first (the old `sid` is unusable), replaces the stored
data with `data`, updates `length`, and marks the session modified so the guard
persists it. `clear()` empties every key and marks the session modified, so the
guard deletes the row and expires the cookie — the request continues
anonymously, which makes `requireSession()` deny the next request. Both are
no-ops with a warning on a readonly mount.

`SESSION_LIFETIME` and `COOKIE_LIFETIME` are measured in days and fractional
values are honoured to the millisecond (`0.5` is twelve hours). The guard
serializes the cookie before persisting: a `MAX_COOKIE_SIZE` overflow answers
with a JSON `500` and leaves no row behind. **Behavior change:** previously the
row could be written before cookie serialization failed, leaving an orphaned
session.

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
      // Atomically claim the token; return true only for the winning caller.
      return true;
    },
    deleteExpired: async (before) => {
      // Optional cleanup: remove rows expired before `before` (Unix ms).
      return 0;
    },
  },
  process.env.JWT_SECRET!,
  { tokenValidity: 15, refreshValidity: 7 },
);

@route("/refresh")
@use(jwtAuth(jwt), jwtRefresh(jwt))
class Refresh extends Methods {
  post({ data, res }: ctx) {
    return res.json({ tokens: data.jwtTokens });
  }
}
```

The store's `consume()` must be atomic. It is a claim-once contract: the winning
caller gets `true`, every later call gets `false`. The store may delete the row
or keep it with a `consumed_at` stamp; keeping the audit trail is allowed, only
the boolean result matters. Access tokens default to 15 minutes and refresh
tokens to 7 days.

Mount `jwtAuth` before `jwtRefresh` on a combined route. `jwtAuth` stores access
claims in `ctx.jwtData`; `jwtRefresh` keeps refresh claims in
`ctx.data.jwtRefreshData`, leaves `ctx.jwtData` alone when it is already
populated (refresh claims also populate `ctx.jwtData` when no access claims
exist), and issues the replacement pair into `ctx.data.jwtTokens`. When an
`Authorization` header is present, `jwtRefresh` verifies it before claiming the
refresh token, so a failed access check does not burn the token. For a single
rotation endpoint use `jwtRotate(jwt)`; it accepts an optional access token and
performs both steps.

Refresh failures answer `401` with the guard's message, a `WWW-Authenticate:
Bearer` header, and an `error_code` of `"invalid"`, `"expired"`, or `"reused"`.
`"reused"` means a validly signed token is no longer available in the store.
`JWTAuthService.consumeWithReason()` reports the same distinction;
`consume()` keeps returning claims or `null`.

Call `sign(payload, lifetimeSeconds)` for a per-call access-token lifetime; the
second argument is in seconds and overrides the minute-based `tokenValidity` for
that token only. `JWTAuthService.deleteExpired(before?)` forwards to the store's
optional `deleteExpired(before)`, which defaults to now; a store without the hook
is a no-op.

See [`doc/session-auth.md`](session-auth.md) for an SQLite-backed session
service.

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
and `.default(value)`, plus `.autoIncrement()` on `serial()`, `int()`, and
`bigint()` columns. The flag renders per dialect — SQLite
`PRIMARY KEY AUTOINCREMENT` (primary-key columns only), PostgreSQL
`GENERATED BY DEFAULT AS IDENTITY`, MySQL `AUTO_INCREMENT` for non-serial
columns — and unsupported column types throw a `TypeError`.

`DbSchema<T>` combines a table name, typed column definitions, and a dialect. It
can emit DDL (`createSQL`) and column definitions, and it exposes `columns` for
type-safe references. The selected dialect maps logical types to native column
types. An optional fourth argument declares secondary indexes, emitted with the
table DDL and applied idempotently by `create()`:

```ts
const schema = new DbSchema<{ id: number; topic: string; body: string }>(
  "messages",
  {
    id: t.serial().primary.autoIncrement(),
    topic: t.text().notNull,
    body: t.text().notNull,
  },
  sqliteDialect,
  {
    indices: [
      { name: "messages_topic_id", columns: ["topic", "id"] },
      { name: "messages_body", columns: ["body"], unique: true },
    ],
  },
);
```

Index names must be unique per schema, columns must exist in the definition, and
`unique` is optional. `schema.indices` returns the validated list;
`createTableSQL()`, `createIndexSQLs()`, and `createStatements()` expose the
generated DDL, and `createSQL()` combines table and indexes. Re-running
`create()` is a no-op for existing tables and indexes.

### Repository

`DbRepository<T>` provides:

- `create()` and `syncColumns(allowDrop?)`.
- `testConnection()` and `withContext(sql)`.
- `insert`, `find`, `findAll`, `findMany`, `paginate`, `count`, and `exists`.
- `update`, `delete`, and `transaction`.
- `inspect` for a bound `DbInspector`.

`syncColumns()` adds missing columns and keeps existing data. Pass `true` only
when dropping columns is intentional. `Where<T>` values may be plain values or
`{ operator, value }` objects. Supported operators include `=`, `!=`, `<`,
`<=`, `>`, `>=`, `LIKE`, `ILIKE`, `IS`, `IS NOT`, `IN`, and `NOT IN`. Values are
bound as parameters; keep table and column names in trusted schema definitions.

`findMany({ where?, orderBy?, limit? })` adds ordered, limited reads without raw
SQL — for example "latest N rows", newest first:

```ts
const recent = await users.findMany({
  where: { name: "Rosa" },
  orderBy: { column: "id", direction: "desc" },
  limit: 20,
});
```

`where` accepts the same conditions as `findAll`. `orderBy.column` must be a
schema column and `direction` is `"asc"` (default) or `"desc"`; both are
validated, and `limit` must be a positive safe integer. The option type is
exported as `FindManyOptions<T>`.

### Dialects

The package exports `sqliteDialect`, `postgresDialect`, `mysqlDialect`,
`mariadbDialect`, and `getDialect(name)` for `"sqlite"`, `"postgres"`, `"mysql"`,
and `"mariadb"`. Bun's `mysql2://` URL works with `mysqlDialect`.

Custom `DbDialectAdapter` implementations must implement the two index members
added for declarative indexes: `createIndexSQL(table, index)` (returns the
`CREATE INDEX` statement or statements for the dialect) and
`createIndex(db, schema, index)` (applies it idempotently). Existing adapters
that only implement table DDL need these methods before they compile against
0.1.5.

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

  // Dispatch is slot-exact, so pair HEAD with GET. Keep headers, drop the body.
  async head({ req, res }: ctx) {
    if (!req.isFile) return res.null(404);
    const response = await res.fileServer();
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
}
```

A `res.fileServer()`-based catch-all answers only the methods it declares;
without the `head()` pairing, `curl -I <asset>` reaches the base `head()` and
answers `404`. Pairing it as above makes HEAD mirror the GET status,
`Content-Type`, `Content-Length`, and other headers with an empty body while
missing paths stay `404` for both. The built-in `staticFiles()` guard needs no
pairing: it intercepts GET and HEAD together and already strips the HEAD body,
so mounting `app.use(staticFiles())` (or a prefixed/rooted variant) is the
shortest path for a whole asset tree.

Serving behavior:

- The resolved path must remain inside the client root, including after
  `realpath` symlink resolution. Escapes return `403`.
- Missing files return `404`.
- Files up to 50 KiB are buffered in an in-memory cache for 15 minutes and
  served with a weak content-hash `ETag` and
  `Cache-Control: public, max-age=900, must-revalidate`. Every request
  revalidates the entry with one cheap size/mtime `stat`; when the file changed
  on disk the entry is dropped and the bytes are re-read, so an edited asset is
  served immediately with a new `ETag` instead of after the TTL.
- Larger files are stat'd fresh on every request and sent through `res.file()`
  with a weak `ETag`, `Last-Modified`, and the same `Cache-Control`, without
  being buffered.
- `If-None-Match` accepts `*` and comma-separated ETag lists under weak
  comparison and answers `304` on both paths. Those `304` responses carry
  `Vary: Accept-Encoding` when the app negotiates an encoding.
- The large-file path keeps Bun-file byte-range support; cached small files are
  raw buffers, advertise `Accept-Ranges: none`, and ignore `Range`. `res.file()`
  supports ranges on a `Uint8Array` only with `meta.ranges: true`, and invalid
  ranges return `416`. See [File responses](#file-responses).
- `staticFiles({ root, dev: true })` bypasses the small-file cache entirely, so
  every request reads fresh bytes. `dev` requires `root`; without it the mount
  uses the app-wide server, whose shared cache cannot be opted out of here. The
  TTL and the > 50 KiB always-fresh path are unchanged when `dev` is omitted.

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
