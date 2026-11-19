# Login backend examples

Two small Bun servers demonstrate registration, login, and a current-user
endpoint. Both use SQLite for user records and `Bun.password` for password
hashing. They are learning examples; add rate limits, email verification,
account recovery, and deployment-specific cookie/TLS settings before use in a
production application.

Set a private signing secret and start one example:

```sh
export AUTH_SECRET="$(openssl rand -base64 48)"
bun run examples/login/session-login.ts
# Or, in a separate process:
bun run examples/login/jwt-login.ts
```

The session server listens on port 3000 and persists sessions in
`login-sessions.sqlite`. For local HTTP it sets `COOKIE_SECURE: false`; enable
secure cookies when serving over HTTPS. The JWT server listens on port 3001 and
stores one-time refresh tokens in `login-jwt.sqlite`.

Register and log in against either server:

```sh
curl -i http://127.0.0.1:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"a-long-demo-password"}'

curl -i -c cookies.txt http://127.0.0.1:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"a-long-demo-password"}'

curl -b cookies.txt http://127.0.0.1:3000/auth/me
```

For JWT, use port 3001. The login response contains `accessToken` and
`refreshToken`; send the access token as `Authorization: Bearer <token>` to
`/auth/me`. Send a refresh token in `x-refresh-token` to `POST /auth/refresh`
to consume it once and receive a replacement token pair.
