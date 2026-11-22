# Changelog

Notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
