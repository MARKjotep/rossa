# Changelog

Notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
