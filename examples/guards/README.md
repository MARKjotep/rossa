# Guards playground

A self-contained, runnable tour of rossa's HTTP guards. Every card on
`http://localhost:8790` calls a real route with a pass path and an easy fail
path; no database, credentials, or extra services are required.

## Run

```sh
bun run examples/guards/server.ts
# optional: PORT=9000 bun run examples/guards/server.ts
```

Open <http://localhost:8790>. The server console prints one line per request
from the global `loggerFN` guard; `security()` adds hardening headers to every
response and `staticFiles()` serves `/index.html` directly.

## What is mounted

| Route | Guards | Pass demo | Fail demo |
| --- | --- | --- | --- |
| `POST /api/json` | `json`, `keys` | `{"name":"Ada","count":"3"}` (count becomes a number) | wrong content-type → 415; missing `count` → 400; empty name → 400 |
| `GET /api/query` | `validateQuery` | `?page=2&q=rossa` | `?page=0` or `?page=abc` → 400 |
| `POST /api/form` | `urlencoded`, `validateForm` | `name=Ada&age=36` | `name=A` → 400 |
| `POST /api/upload` | `contentType`, `multipart` | multipart with any file | JSON body → 415 |
| `GET /api/secure` | `header`, `logger` | `x-api-key: demo-key` | missing → 401, wrong → 400 |
| `GET /api/bearer` | `authBearer` | `Authorization: Bearer demo-token` | missing/wrong → 401 |
| `GET /api/key` | `apiKey` | `x-api-key: demo-key` | missing → 401 |
| `GET /api/auth` | `auth` | `x-api-key: demo-key` + `x-role: admin` | wrong role → 401 |
| `GET /api/rate` | `rateLimit` | first 3 requests in 10s → 200 | 4th → 429 + `Retry-After` |
| `GET /api/timeout` | `timeout(150)` | fast handler → 200 | `?slow=1` (500ms) → 408 |
| `POST /api/sanitize` | `json`, `keys`, `sanitize` | `<script>` becomes `&lt;script&gt;` | non-string text → 400 |
| `GET /api/url` | `validateUrl` | `?ok=hello` | extra key / duplicate / uppercase → 400 |
| `GET /api/cors` | `cors` | local origin echoed, same-origin gets `*` | `Origin: http://evil.example` → 403 |
| `OPTIONS /api/cors` | `cors` | preflight → 204 with CORS headers | — |
| `GET /api/ip` | `ipFilter` allowlist | loopback passes | edit the allowlist to block loopback |
| `GET /api/ip-blocked` | `ipFilter` blacklist | — | loopback → 403 |
| `GET /api/cookies` | `cookies("sid")` | `Cookie: sid=demo-session` | no cookie → 401 |
| `GET /api/cache` | `smartCache` | two GETs share `handlerRuns`/`generatedAt` | cache is bypassed by cookies/auth |
| `GET /api/csrf` | `csrf` | issues `csrf_token` cookie | — |
| `POST /api/csrf` | `csrf` | `x-csrf-token` matches cookie → 200 | missing/mismatched header → 403 |
| `GET /api/session` | `session` | in-memory visit counter persists | — |
| `POST /api/jwt/login` | — | issues a demo token pair | — |
| `GET /api/jwt/me` | `jwtAuth` | `Authorization: Bearer <access>` | no/bad token → 401 |
| `POST /api/jwt/refresh` | `jwtRefresh` | `x-refresh-token` → new pair | unknown token → 401 |
| `GET /api/async` | `createGuard` async + async handler | ordered step list | `?delay=5000` / `?delay=abc` → 400 |

`GET /` serves the playground; `GET /index.html` is also served through
`staticFiles()`. `types` is a type-only export (`GlobalGuard`), so it is used in
the README rather than mounted as a route. Everything else in the framework's
guard list is mounted and exercised live.

## Guard order

- `app.use(...)` **unshifts**: the last global guard registered runs first.
  This example calls `app.use(staticFiles())`, then `security()`, then
  `loggerFN(...)`, so the execution order is
  `loggerFN → security → staticFiles → route-local chain`.
- `@use(a, b, c)` preserves declaration order and runs `a → b → c`. Order
  matters: `/api/sanitize` needs `json → keys → sanitize` so `ctx.body` exists
  before escaping; `/api/upload` needs `contentType → multipart`.
- Global guards wrap local chains, so `security()` can add headers to guard
  errors and static files too. Caching runs inside the global chain; public
  responses are cached before `security()` rewrites the headers for each hit.

## Async methods

`GET /api/async` proves the framework awaits the whole chain before sending a
response:

1. `asyncDelay(80)` is created with `createGuard`. It validates
   `?delay=N` (`0..1000`), records the start time, waits `80 + N` ms, then
   appends `"guard-delay"` to `ctx.data.steps` and awaits `next()`.
2. The async handler awaits 40ms, appends `"handler-step-1"`, awaits 60ms,
   appends `"handler-step-2"`, then returns `{ steps, waitedMs }`.
3. The expected order is always
   `["guard-delay", "handler-step-1", "handler-step-2"]`, and `waitedMs` is at
   least `180 + N` (measured on the server from the start of the guard).

The page's "Async" card shows `waiting…` while the fetch is in flight, so a
`?delay=800` run visibly waits about a second before rendering the steps.

## Fail-path curl recipes

```sh
B=http://localhost:8790

# json / keys
curl -i -X POST $B/api/json -H 'content-type: text/plain' -d '{"name":"Ada","count":1}'
curl -i -X POST $B/api/json -H 'content-type: application/json' -d '{"name":"Ada"}'
curl -i -X POST $B/api/json -H 'content-type: application/json' -d '{"name":"","count":1}'

# query / form / upload
curl -i "$B/api/query?page=0"
curl -i -X POST $B/api/form -H 'content-type: application/x-www-form-urlencoded' -d 'name=A&age=36'
curl -i -X POST $B/api/upload -H 'content-type: application/json' -d '{}'

# header / bearer / apiKey / auth
curl -i $B/api/secure
curl -i $B/api/secure -H 'x-api-key: wrong'
curl -i $B/api/bearer
curl -i $B/api/key
curl -i $B/api/auth -H 'x-api-key: demo-key' -H 'x-role: guest'

# rate limit: 4 requests inside 10s; the 4th is 429
for i in 1 2 3 4; do curl -i $B/api/rate; done

# timeout
curl -i "$B/api/timeout?slow=1"

# sanitize
curl -i -X POST $B/api/sanitize -H 'content-type: application/json' -d '{"text":42}'

# url validation
curl -i "$B/api/url?ok=hello&bad=1"
curl -i "$B/api/url?ok=hello&ok=world"
curl -i "$B/api/url?ok=HELLO"

# CORS: only local origins are echoed
curl -i $B/api/cors -H 'Origin: http://evil.example'
curl -i -X OPTIONS $B/api/cors -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: GET'

# IP filters (loopback)
curl -i $B/api/ip-blocked

# cookies
curl -i $B/api/cookies
curl -i $B/api/cookies -H 'Cookie: sid=demo-session'

# cache: two calls, compare handlerRuns / generatedAt
curl -s $B/api/cache; echo; curl -s $B/api/cache; echo

# csrf: capture the cookie, then POST without and with the header
curl -s -c /tmp/guards-cookies.txt $B/api/csrf
curl -i -b /tmp/guards-cookies.txt -X POST $B/api/csrf \
  -H 'content-type: application/json' -d '{}'
TOKEN=$(curl -s -c /tmp/guards-cookies.txt $B/api/csrf | sed -E 's/.*"token":"([^"]+)".*/\1/')
curl -i -b /tmp/guards-cookies.txt -X POST $B/api/csrf \
  -H 'content-type: application/json' -H "x-csrf-token: $TOKEN" -d '{}'

# session: the visit counter persists across requests that send the cookie
curl -s -c /tmp/guards-session.txt $B/api/session; echo
curl -s -b /tmp/guards-session.txt $B/api/session; echo

# JWT: login, call /me, refresh, and fail without a token
LOGIN=$(curl -s -X POST $B/api/jwt/login)
AT=$(echo "$LOGIN" | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
RT=$(echo "$LOGIN" | sed -E 's/.*"refreshToken":"([^"]+)".*/\1/')
curl -i $B/api/jwt/me -H "authorization: Bearer $AT"
curl -i $B/api/jwt/me
curl -i -X POST $B/api/jwt/refresh -H "x-refresh-token: $RT"
curl -i -X POST $B/api/jwt/refresh -H 'x-refresh-token: not-a-token'

# async: invalid/capped delay and the visible wait
curl -i "$B/api/async?delay=5000"
curl -i "$B/api/async?delay=abc"
curl -s "$B/api/async?delay=200"
```

## Notes

- **Rate limit reset:** the window is 10 seconds per IP + method + path. Wait
  for `X-RateLimit-Reset` / `Retry-After`, or restart the server.
- **Cache:** `smartCache({ ttlMs: 15_000 })` keys on the full URL and only
  caches public 200 GET responses. Requests with `Cookie`, `Authorization`, or
  `Cache-Control: no-cache` bypass it, which is why the page scopes its demo
  cookies to their route paths.
- **JWT and sessions are in-memory** in this example. Tokens/sessions live only
  for the process lifetime; no secret env var or database is needed.
- **Security headers** (`X-Frame-Options`, `nosniff`, referrer policy) are
  visible on every response, including guard errors and static files.
