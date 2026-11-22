# Guard layers playground

Five realistic request paths where multiple rossa guards stack. Every path
authenticates first, then applies narrower approval layers. Each card in the
browser playground exposes the happy path and every denying layer, so the real
status codes and JSON error bodies are visible without extra tooling. Scenario
5's signed happy path is covered by the curl recipe and smoke test because the
page intentionally has no client-side HMAC signer.

- No database, no external service, and no new dependencies: sessions,
  refresh tokens, audit entries, partner quotas, and webhook replay hashes live
  in memory and reset on restart.
- The page handles admin/member JWTs, the account session cookie, and CSRF
  tokens for you.
- Scenario 5 intentionally has no browser-side HMAC signer. The page shows the
  401 path; the signed 200/403/400 paths are exercised by the curl recipes below
  and by the smoke test.

## Run

```sh
bun run examples/guard-layers/server.ts
# optional: PORT=9000 bun run examples/guard-layers/server.ts
```

Open <http://localhost:8791>. The default port is **8791** (the guards example
uses 8790, so both can run side by side). The server prints one log line per
request through the global `loggerFN` guard.

## Demo identities

| Kind | Credential | Notes |
| --- | --- | --- |
| Admin JWT | `admin@example.com` / `admin-demo` | `POST /admin/login`; claims include `role: "admin"` |
| Member JWT | `member@example.com` / `member-demo` | `POST /admin/login`; valid token, insufficient role |
| Account session | `ada@example.com` / `correct-horse` | `POST /api/account/login`; sets session + CSRF cookies |
| Account session | `grace@example.com` / `hopper-demo` | second seeded account |
| Partner gold | `partner-gold-key` | 10 requests / 10s |
| Partner silver | `partner-silver-key` | 3 requests / 10s |
| Webhook secret | `whsec_demo_guard_layers` | HMAC-SHA256 over the raw body |

## Layer order at a glance

| # | Endpoint | Stack (left → right) |
| --- | --- | --- |
| 1 | `GET /admin/panel` | `jwtAuth` → `requireRole("admin")` → `ipFilter` → `auditLog` |
| 2 | `POST /api/account/settings` | `session` → `requireSession` → `csrf` → `json(schema)` → `rateLimit` |
| 3 | `GET /partner/v1/data` | `apiKey` → per-tier quota → `timeout(200)` |
| 4 | `POST /api/account/avatar` | `session` → `requireSession` → `contentType` → `multipart` → `validateAvatar` → `sanitize` |
| 5 | `POST /webhooks/payments` | `hmacSignature` → `ipFilter` → `webhookReplay` → `json(schema)` |

`@use(a, b, c)` runs guards in declaration order. Global guards are registered
last-first (LIFO): this example calls `app.use(staticFiles())`, then
`security()`, then `loggerFN(...)`, so the global order is
`loggerFN → security → staticFiles → route-local chain`.

The curl recipes use `jq` to pull tokens from JSON responses.

---

## 1. Admin panel

`GET /admin/panel` — JWT authentication, role authorization, office network
policy, and an audit record.

| Layer | Guard | Fail status | Demo trigger |
| --- | --- | --- | --- |
| 1 | `jwtAuth(jwt)` | **401** | no `Authorization` header, or an invalid/expired token |
| 2 | `requireRole("admin")` | **403** | valid member token |
| 3 | `ipFilter(adminIpPolicy)` | **403** | allowlist without loopback (playground toggle) |
| 4 | `auditLog()` | — (records only) | blocked requests never reach it, so they are not audited as approved |

**Why this order.** Authentication is first because nothing else should run
against an unverified identity. Authorization is next because the role is a
property of the verified identity; a member should be rejected before any
network or audit work. The IP allowlist is the last gate before the handler and
side effects. The audit layer runs last so the trail means "fully approved
requests", not "requests that arrived".

The role guard reads `ctx.jwtData.claims`, which `jwtAuth` populated from the
public `JWTAuthService` payload. `GET /admin/audit` (admin JWT + role only) shows
the last 20 accepted entries.

```sh
B=http://localhost:8791
ADMIN=$(curl -s -X POST $B/admin/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"admin-demo"}' | jq -r .accessToken)
MEMBER=$(curl -s -X POST $B/admin/login -H 'content-type: application/json' \
  -d '{"email":"member@example.com","password":"member-demo"}' | jq -r .accessToken)

curl -i $B/admin/panel -H "authorization: Bearer $ADMIN"        # 200
curl -i $B/admin/panel -H "authorization: Bearer $MEMBER"       # 403 role
curl -i $B/admin/panel                                          # 401 missing
curl -i $B/admin/panel -H 'authorization: Bearer not-a-jwt'     # 401 invalid
curl -i $B/admin/audit -H "authorization: Bearer $ADMIN"        # audit trail

# Disallowed IP: flip the demo allowlist, prove 403, then restore it.
curl -s -X POST $B/demo/ip-policy -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"target":"admin","allowLoopback":false}'
curl -i $B/admin/panel -H "authorization: Bearer $ADMIN"        # 403 IP
curl -s -X POST $B/demo/ip-policy -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"target":"admin","allowLoopback":true}'
```

`GET /demo/ip-policy` is a demo-only control route protected by admin JWT +
role. It changes the in-memory allowlist at runtime so loopback can be excluded
without restarting. A production app would not expose such a route.

## 2. Account settings

`POST /api/account/settings` — change email and display name.

| Layer | Guard | Fail status | Demo trigger |
| --- | --- | --- | --- |
| 1 | `session(sessions)` | — | loads a session or creates an empty one |
| 2 | `requireSession()` | **401** | no session cookie (`fetch(..., { credentials: "omit" })`) |
| 3 | `csrf()` | **403** | missing/mismatched `x-csrf-token` vs the `csrf_token` cookie |
| 4 | `json(SettingsBody)` | **400** (or 415) | invalid email / display name; wrong content type |
| 5 | `rateLimit({ max: 5, windowMs: 10_000 })` | **429** | a burst of valid writes |

`POST /api/account/login` uses `rateLimit` → `session` → `json`, checks the
seeded in-memory user map, then persists the session and issues a readable
`csrf_token` cookie plus the token in the response body. The login limiter is
5 attempts / 15s.

**Why this order.** `session()` only loads the cookie; it never rejects an
anonymous request. The framework `requireSession()` guard is the explicit 401
assertion; this example passes a validator that also requires the `userId`
written at login, so a missing cookie cannot silently become a CSRF failure. CSRF runs before body
parsing because a cross-site write should be rejected without paying parse and
validation cost. The schema then rejects malformed updates before they consume
the small authenticated-write budget. The limiter runs last to protect the
account mutation itself; this also keeps malformed or unauthenticated requests
from exhausting a legitimate user's budget.

```sh
B=http://localhost:8791
JAR=$(mktemp)
LOGIN=$(curl -s -c $JAR -X POST $B/api/account/login -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse"}')
CSRF=$(printf %s "$LOGIN" | jq -r .csrfToken)

curl -i -X POST $B/api/account/settings -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","displayName":"Ada L."}'               # 401 no cookie
curl -i -b $JAR -X POST $B/api/account/settings -H 'content-type: application/json' \
  -H 'x-csrf-token: wrong' \
  -d '{"email":"ada@example.com","displayName":"Ada L."}'               # 403 CSRF
curl -i -b $JAR -X POST $B/api/account/settings -H 'content-type: application/json' \
  -H "x-csrf-token: $CSRF" \
  -d '{"email":"not-an-email","displayName":"x"}'                       # 400 schema
curl -i -b $JAR -X POST $B/api/account/settings -H 'content-type: application/json' \
  -H "x-csrf-token: $CSRF" \
  -d '{"email":"ada@example.com","displayName":"Ada L."}'               # 200

# Burst: after one happy path, requests 6-7 inside 10s return 429.
for i in 1 2 3 4 5 6 7; do
  curl -s -o /dev/null -w '%{http_code}\n' -b $JAR \
    -X POST $B/api/account/settings -H 'content-type: application/json' \
    -H "x-csrf-token: $CSRF" \
    -d "{\"email\":\"ada@example.com\",\"displayName\":\"Ada $i\"}"
done
```

## 3. Partner API

`GET /partner/v1/data` — API key, tier quota, and a handler timeout.

| Layer | Guard | Fail status | Demo trigger |
| --- | --- | --- | --- |
| 1 | `apiKey(lookupPartner)` | **401** | missing or unknown `x-api-key` |
| 2 | `tierQuota()` | **429** | silver: 4th request inside 10s; gold: 11th |
| 3 | `timeout(200)` | **408** | `?slow=1` makes the handler sleep 350ms |

The custom key guard resolves `partner-gold-key` or `partner-silver-key` and
stores `tier` and `partner` on `ctx.data`. The quota guard reads that tier:
gold is 10 requests / 10s, silver 3 requests / 10s. Unknown keys never create
quota buckets.

**Why this order.** The key must be validated before the tier exists, so
`apiKey` is first. The quota then sheds load before any handler work and is
keyed by the resolved partner + tier. `timeout` wraps only the downstream
handler, so it measures handler latency rather than authentication overhead.

```sh
B=http://localhost:8791
curl -i $B/partner/v1/data -H 'x-api-key: partner-gold-key'    # 200, tier: gold
curl -i $B/partner/v1/data -H 'x-api-key: nope'                 # 401 unknown
curl -i $B/partner/v1/data                                      # 401 missing
curl -i $B/partner/v1/data -H 'x-api-key: partner-silver-key'   # 200

# Silver quota: 3/10s. After the request above, the 3rd/4th here is 429.
for i in 1 2 3 4; do curl -i $B/partner/v1/data -H 'x-api-key: partner-silver-key'; done

curl -i "$B/partner/v1/data?slow=1" -H 'x-api-key: partner-gold-key'  # 408
```

## 4. Avatar upload

`POST /api/account/avatar` — authenticated multipart upload with MIME and size
validation, plus text-field sanitization. The handler echoes
`{ name, size, type }` and writes nothing to disk.

| Layer | Guard | Fail status | Demo trigger |
| --- | --- | --- | --- |
| 1 | `session(sessions)` | — | loads the account session |
| 2 | `requireSession()` | **401** | no session cookie |
| 3 | `contentType("multipart/form-data")` | **415** | JSON or text body |
| 4 | `multipart()` | **400** | malformed multipart body |
| 5 | `validateAvatar()` | **413 / 415 / 400** | > 1 MiB; wrong MIME; missing/duplicate `avatar` |
| 6 | `sanitize({ form: true })` | — | escapes text fields (`<script>` → `&lt;script&gt;`) |

Allowed file types are `image/png`, `image/jpeg`, and `image/webp`; the limit is
1 MiB. File validation runs before `sanitize()` so an invalid file is rejected
before any text fields are rewritten.

**Why this order.** Authentication comes first so anonymous uploads never pay
multipart parsing cost. `contentType` rejects unsupported encodings before the
parser allocates form data. `multipart` must run before file validation because
`ctx.form` does not exist yet. `sanitize` runs last so the handler sees escaped
text fields while `File` values pass through untouched.

```sh
B=http://localhost:8791
JAR=$(mktemp)
curl -s -c $JAR -X POST $B/api/account/login -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse"}'

curl -i -b $JAR -X POST $B/api/account/avatar \
  -F 'avatar=@avatar.png;type=image/png' \
  -F 'caption=<script>alert(1)</script>' -F 'bio=<b>hello</b>'      # 200
curl -i -X POST $B/api/account/avatar \
  -F 'avatar=@avatar.png;type=image/png'                             # 401 no session
curl -i -b $JAR -X POST $B/api/account/avatar \
  -H 'content-type: application/json' -d '{"avatar":"x"}'            # 415 content type
curl -i -b $JAR -X POST $B/api/account/avatar \
  -F 'avatar=@notes.txt;type=text/plain'                             # 415 MIME
dd if=/dev/zero of=big.png bs=1048577 count=1 2>/dev/null
curl -i -b $JAR -X POST $B/api/account/avatar \
  -F 'avatar=@big.png;type=image/png'                                # 413 too large
curl -i -b $JAR -X POST $B/api/account/avatar -F 'caption=no file'   # 400 missing
```

## 5. Payment webhook

`POST /webhooks/payments` — HMAC signature, provider IP allowlist, replay
protection, and payload schema.

| Layer | Guard | Fail status | Demo trigger |
| --- | --- | --- | --- |
| 1 | `hmacSignature()` | **401** | missing signature, or `x-signature` ≠ HMAC-SHA256 hex of the raw body |
| 2 | `ipFilter(providerIpPolicy)` | **403** | provider allowlist without loopback (playground toggle) |
| 3 | `webhookReplay()` | **400** | `timestamp` older than 5 minutes (or > 5 minutes ahead), or a body hash already seen |
| 4 | `json(PaymentBody)` | **400** (or 415) | `eventId` not a string, `amount` negative/uncoercible, wrong content type |

`x-signature` is the lowercase HMAC-SHA256 hex digest of the **raw request
body** using `whsec_demo_guard_layers`. `timestamp` is Unix seconds. The replay
cache stores body hashes for five minutes.

**Why this order.** The HMAC must be checked before JSON parsing because it is
computed over the raw bytes; it also rejects forged traffic before any other
work. `ctx.req.text()` caches the raw body, so the signature guard, replay
guard, and `json()` all read the same bytes without consuming the stream twice.
The provider IP allowlist is the next trust boundary. Replay protection runs
after IP filtering so only trusted provider traffic can touch the in-memory hash
cache. Schema validation is last, once authenticity, origin, and freshness are
established.

```sh
B=http://localhost:8791
SECRET='whsec_demo_guard_layers'
BODY='{"eventId":"evt_1","amount":12.5,"timestamp":'$(date +%s)'}'
SIG=$(printf %s "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')

curl -i -X POST $B/webhooks/payments -H 'content-type: application/json' \
  -H "x-signature: $SIG" -d "$BODY"                                # 200 happy
curl -i -X POST $B/webhooks/payments -H 'content-type: application/json' \
  -H "x-signature: $SIG" -d "$BODY"                                # 400 replay
curl -i -X POST $B/webhooks/payments -H 'content-type: application/json' \
  -H 'x-signature: deadbeef' -d "$BODY"                            # 401 bad signature
curl -i -X POST $B/webhooks/payments -H 'content-type: application/json' \
  -d "$BODY"                                                       # 401 missing signature

# Stale timestamp with a valid signature.
STALE='{"eventId":"evt_stale","amount":1,"timestamp":'$(($(date +%s) - 600))'}'
STALE_SIG=$(printf %s "$STALE" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')
curl -i -X POST $B/webhooks/payments -H 'content-type: application/json' \
  -H "x-signature: $STALE_SIG" -d "$STALE"                         # 400 stale

# Schema violation with a fresh signed body.
BAD='{"eventId":123,"amount":-1,"timestamp":'$(date +%s)'}'
BAD_SIG=$(printf %s "$BAD" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')
curl -i -X POST $B/webhooks/payments -H 'content-type: application/json' \
  -H "x-signature: $BAD_SIG" -d "$BAD"                             # 400 schema

# Provider IP gate: admin token required for the demo control.
ADMIN=$(curl -s -X POST $B/admin/login -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"admin-demo"}' | jq -r .accessToken)
curl -s -X POST $B/demo/ip-policy -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"target":"provider","allowLoopback":false}'
IP_BODY='{"eventId":"evt_ip","amount":1,"timestamp":'$(date +%s)'}'
IP_SIG=$(printf %s "$IP_BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}')
curl -i -X POST $B/webhooks/payments -H 'content-type: application/json' \
  -H "x-signature: $IP_SIG" -d "$IP_BODY"                          # 403 IP
curl -s -X POST $B/demo/ip-policy -H "authorization: Bearer $ADMIN" \
  -H 'content-type: application/json' -d '{"target":"provider","allowLoopback":true}'
```

## Playground notes

- **Scenario 1** stores the admin and member access tokens separately. The
  "disallowed IP" button flips the demo allowlist, proves the 403, and restores
  loopback in the same click.
- **Scenario 2** logs in with the fields at the top of the card, stores the
  CSRF token from the login response, and reuses the browser session cookie. The
  no-session fail uses `credentials: "omit"`, so it never sees the cookie.
- **Scenario 4** reuses the account session from card 2. A tiny generated PNG
  proves the happy path without a fixture file; the "chosen file" button uses
  the file picker.
- **Scenario 3** quota buckets are per partner + tier and reset after 10s.
  Running "silver happy" before "burst" still makes the burst end in 429.
- **Scenario 5** deliberately has no client-side signer: embedding the shared
  secret in browser JavaScript would defeat the point. The card only shows the
  401 path; use the curl recipes for the signed 200/403/400 paths.

## Layout

| File | Purpose |
| --- | --- |
| `server.ts` | Five routes, demo stores, custom guards, and the playground route |
| `index.html` | Self-contained dark playground; no build step |
| `README.md` | This document |

The example imports only from `../../src/index` plus `node:crypto` and
`node:path`. Sessions, JWT refresh tokens, audit entries, partner quotas, CSRF
tokens, and webhook replay hashes are in memory and disappear when the server
stops.
