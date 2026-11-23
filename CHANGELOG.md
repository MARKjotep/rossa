# Changelog

Notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-11-23

### Fixed

- MCP `origin` scheme wildcards: `origin: ["https://*"]` now allows any https
  origin (and `"http://*"` any http origin) instead of matching nothing. Rossa
  validates `http`/`https` wildcards itself before handing the request to the
  MCP SDK, whose own wildcard rule honours only non-web schemes. Semantics:
  `"https://*"` allows every https origin and rejects http, `"http://*"` is the
  inverse, non-web wildcards such as `"moz-extension://*"` behave exactly as
  before, exact origins stay exact (scheme/host/port), plain hostname entries
  stay port-agnostic, missing `Origin` headers still pass, and omitting
  `origin` still disables validation (B2).

### Added

**Database**

- `DbRepository.findMany({ where?, orderBy?, limit? })` for typed, ordered,
  limited reads without raw SQL. Columns and directions are validated against
  the schema and bound as parameters.
- Declarative secondary indexes: `new DbSchema(table, columns, dialect, {
  indices: [{ name, columns, unique? }] })`, emitted idempotently by
  `create()`/`createSQL()` for every dialect, with `indices`,
  `createTableSQL()`, `createIndexSQLs()`, and `createStatements()`.
- `Column.autoIncrement()` (with `Column.isAutoIncrement`) on `serial()`,
  `int()`, and `bigint()` columns, rendered per dialect (`AUTOINCREMENT` on
  SQLite primary keys, PostgreSQL identity, `AUTO_INCREMENT` for non-serial
  MySQL columns).

**Guards and sessions**

- `csrf({ mode: "double-submit", bodyField? })`: compares a JSON or form body
  token with the `csrf_token` cookie, still rejecting a supplied mismatched
  header. Header mode is unchanged.
- `csrf.issue(ctx, options?)` / `csrf.token(ctx)` mint a token, write the
  matching cookie through `res.setCookie`, and return `{ token, cookie }`.
- `session.reset(data)` rotates and replaces the stored data in one call;
  `session.clear()` empties it so the guard deletes the row and expires the
  cookie. Both are no-ops with a warning on readonly mounts.
- `res.setCookie(name, value, options?)` and `res.clearCookie(name, options?)`:
  direct `Set-Cookie` writes with per-call header preservation, reusing
  `CookieOptions` and value sanitization.

**WebSockets**

- `broadcast(topics, data, { includeSelf: true })` also delivers the frame to
  the publishing socket; the default stays sender-exclusive.
- `WssConfig.presence` (`true` or `{ join?, leave? }`) emits automatic
  `{ type, topic, member, members }` join/leave frames, and
  `manager.members(topic)` returns a typed `TopicMember[]`.
- `WssConfig.history` persists accepted frames through a `TopicHistoryStore`
  and replays them oldest → newest on join, with `limit`, `replay`, and
  `persist` controls (`DEFAULT_TOPIC_HISTORY_LIMIT` is `50`).
- `Websocket<TData, TIdentity>` types the guard identity on `this.user` and the
  handshake query on `this.query` (resolved by the default
  `capacityTopics(ctx)`); `this.ws` is now `ServerWebSocket<WssSocketData>`.

**Request**

- `req.autoBody<T>(options?)`: content-type-aware, cached body selection
  (`json` / `form` / `text` / `empty`), 1 MiB default cap, malformed JSON falls
  back to raw text.

### Changed

- **`DbDialectAdapter` contract:** custom dialect implementations must now
  provide `createIndexSQL(table, index)` and `createIndex(db, schema, index)`.
  Adapters written against 0.1.4 no longer satisfy the interface.
- Documentation covers the 0.1.5 surface, including typed WebSocket identity,
  presence/history, cookie writes, CSRF modes, and the explicit `head()` pairing
  for `res.fileServer()` asset controllers (the built-in `staticFiles()` guard
  already answers GET and HEAD together).

## [0.1.4] - 2026-11-23

### ⚠️ Behavior change

- `res.redirect()` is now safe by default. It accepts only origin-relative
  targets and answers `400 {"success":false,"error":"Invalid redirect target"}`
  (with no `Location`) for anything off-origin — absolute, protocol-relative,
  backslash, scheme (`javascript:`, `data:`), or encoded-authority targets.
  Apps that redirect to external URLs must switch to the new
  `res.redirectExternal(url, status?)`, which allows only absolute `http:` or
  `https:` URLs. Bare relatives are normalized (`dashboard` → `/dashboard`,
  `?q=1` → `/?q=1`); `redirectLocal()` remains as an alias, and
  `isLocalRedirectTarget()` shares the same logic.

### Added

- `createSqliteDatabase()`, `configureSqlite()`, `sqliteIntegrityCheck()`, and
  `sqliteWalCheckpoint()` in the database module. They open a Bun SQL SQLite
  connection with WAL, `synchronous=NORMAL`, foreign keys, and a busy timeout,
  and expose the effective settings.

### Changed

- SQLite `optimize()` now also runs `PRAGMA optimize` before `VACUUM` to keep
  query-planner statistics current.
- SQLite `getTableStats()` reports real database size (page count × page size,
  formatted for humans) instead of `"N/A (SQLite file-level)"`.

## [0.1.3] - 2026-11-23

### Fixed

- Redirect targets: untrusted input can no longer send a user to another origin.
  The fix ships as a dedicated safe-target API — `res.redirectLocal(url)` plus
  the `isLocalRedirectTarget(url)` helper. Plain `res.redirect` still forwards
  any target by contract (existing apps keep working) but can no longer inject
  extra headers: CR/LF/NUL and other control characters are stripped from the
  `Location` value.
- Header injection: invalid header values are sanitized when written and again
  when the response is assembled, so a CRLF value can no longer poison the
  builder or drop the connection. `errorHandler()` always answers with a safe
  response (and falls back to a header-free plain-text `500` if assembly still
  throws).
- Body caps: `urlencoded()` and `multipart()` now default to the same 1 MiB
  limit as `json()` and answer `413` with the same error shape. The declared
  `Content-Length` and the bytes actually received are both checked, so a
  lying header cannot bypass the cap.
- SSE: `res.event.*` responses no longer advertise a `Content-Encoding` they do
  not apply. Streams are identity-encoded and decodable by Bun `fetch` and
  browsers without an `Accept-Encoding: identity` override. Normal compressed
  responses are unchanged.

### Added

- `res.redirectLocal(url, status?)` and `isLocalRedirectTarget(url)` for
  origin-relative-only redirects. Invalid targets answer
  `400 {"success":false,"error":"Invalid redirect target"}` with no `Location`.
- `urlencoded({ maxSize })` and `multipart({ maxSize })` body-size caps.
- WebSocket pre-handshake capacity rejection: override `capacityTopics(ctx)` to
  declare the topics a socket will join; a full topic answers the upgrade with
  `503 Service Unavailable` before the handshake instead of delivering a socket
  that cannot subscribe.
- `Websocket.onClose(code, reason)` lifecycle hook (runs before
  `manager.cleanup()`) and `Websocket.terminate(code?, reason?)` as the single
  app-side close path. The old `Websocket.close()` hook is deprecated as an
  alias.
- `backpressured` is documented as a Bun `-1`-only status that application code
  cannot force; it stays in the publish-result union because Bun can return it.

## [0.1.2] - 2026-11-23

### ⚠️ Behavior change

- `sendError` no longer adds `Access-Control-Allow-Origin: *` to error responses,
  so guard rejections are no longer readable by every origin in the browser.
  Apps that relied on the wildcard must set the header explicitly — through the
  `cors()` guard or through a guard's error config, e.g.
  `{ headers: { "Access-Control-Allow-Origin": "..." } }`.

### Fixed

- `serve()` hands the actually bound port to the ready callback and logs the
  bound URL, so `port: 0` reports the OS-assigned port (and `https` with TLS)
  instead of the configured value.
- `multipart()` preserves the MIME type declared on uploaded parts, so `File.type`
  keeps its value instead of being empty.
- `validateUrl` also rejects path-traversal markers in the query string rather
  than checking the path alone.
- `createGuard` honours a per-call `overrideConfig.code` over the guard default.
- Session and cookie lifetimes accept fractional days with millisecond
  precision instead of truncating to whole days.
- A `MAX_COOKIE_SIZE` overflow no longer leaves an orphaned session record or
  surfaces as an empty 500 response.
- Routes that combine `jwtAuth` and `jwtRefresh` no longer overwrite
  `ctx.jwtData`, and a rejected refresh no longer consumes the refresh token.

### Added

- `urlencoded({ strict: true })` opt-in strict parsing mode.
- `json()` also populates `ctx.body` (alongside the existing `ctx.req._json`).
- `session({ auth, readonly })` mounts, `ctx.session.rotate()`, and a typed
  `SessionContext<T>`.
- `jwtRotate` guard: verifies the access token and rotates the refresh token in
  one step.
- Machine-readable refresh rejection reasons in `error_code`
  (`invalid` | `expired` | `reused`).
- `WWW-Authenticate: Bearer` on JWT 401 responses.
- Per-call JWT lifetimes with `sign(payload, lifetimeSeconds?)`.
- Optional `deleteExpired(before)` hook on refresh-token stores for cleanup of
  expired rows.
- Documented claim-once semantics for refresh-token stores (deleting the row or
  marking it consumed are both valid).
- Guard rejection shapes documented in `doc/` and pinned by smoke tests.
