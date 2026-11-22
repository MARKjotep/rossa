# Session manager

`SessionAuthInterface` is the framework extension point for session storage.
Create a concrete subclass that implements `fetchData`, `saveSession`, and
`deleteSession` for your database or key-value store. The SQL-backed example
used by this project is in [`test/Auth/session-auth-service.ts`](../test/Auth/session-auth-service.ts);
adapt it to your own schema and database connection.

Once implemented, the session guard accepts the service instance. It loads the
session before the handler and calls `saveSession()` after the handler returns
if the session changed. Assigning a property such as
`ctx.session.email = user.email` is enough; do not write the session row in the
route handler. `saveSession()` is the persistence point and adds the session
cookie to the response:

```ts
import { session } from "rossa";
import { AppSessionAuthService } from "./session-auth-service";

const sessions = new AppSessionAuthService(db, {
  COOKIE_SECURE: true,
  COOKIE_HTTPONLY: true,
  COOKIE_SAMESITE: "Lax",
}, process.env.SESSION_SECRET!);

await sessions.init();
app.use(session(sessions));
```

Use a long, private signing secret from your deployment secret store. Call
`init()` during startup when your implementation needs to create or validate
its storage schema. Production applications should also choose cookie and
expiration settings for their deployment.

## Requiring a session

`session(service)` loads or creates the session for every request; it does not
require one. On protected routes, compose `requireSession()` after the session
guard so only a store-backed session continues:

```ts
import { requireSession, session } from "rossa";

app.use(session(sessions));

@use(session(sessions), requireSession())
class AccountController {}
```

Anonymous requests, forged or unknown session IDs, and expired sessions get
`401 Authentication required` by default. An optional validator adds an
application identity check, such as
`requireSession((s) => typeof (s as any).userID === "number")`. Do not use
`cookies("session")` for this: it only checks that a cookie is present and
would accept a forged ID.

The lifecycle also unwinds. Once the handler deletes the last session key,
`deleteSession()` removes the row and clears the cookie, so later requests start
anonymous and `requireSession()` denies them.

## Lifetimes and persistence order

`SESSION_LIFETIME` and `COOKIE_LIFETIME` are in days, and fractional values are
honoured to the millisecond: `0.5` is twelve hours, not a truncated day. The
`getSessionExpirationDate` and `getCookieExpirationDate` getters use the same
millisecond arithmetic as cookie serialization, so the stored row and the cookie
expire together.

The guard serializes the session cookie before it persists anything. If
`buildCookieString()` throws — for example because the data exceeds
`MAX_COOKIE_SIZE` — the request answers with a JSON `500` and `saveSession()` is
never called. **Behavior change:** previously the row could be written first and
the cookie failure surfaced afterward, leaving an orphaned session with no
usable cookie. Keep `MAX_COOKIE_SIZE` large enough for your data or validate its
size in the handler.

## Rotation

Call `rotate()` after a successful login to replace the session identifier
(session-fixation defence):

```ts
@route("/login")
class Login extends Methods {
  async post({ session, res }: ctx) {
    const user = await authenticate(); // application code
    await session!.rotate();
    session!.userId = user.id;
    return res.success(200, { userId: user.id });
  }
}
```

`rotate()` deletes the previous row immediately, mints a new signed `sid`, and
marks the session modified; the guard persists the new row and sends the new
cookie after the handler returns. Place it on the success path: a handler that
throws after rotating leaves the old row deleted and the new row unpersisted.
Readonly mounts ignore rotation with a warning. A `ServerSide` created by hand
(without a session service) throws because it has no storage to rotate.

## Readonly mounts and typed sessions

Pass a mount object to load without allowing writes or persistence:

```ts
app.use(session({ auth: sessions, readonly: true }));
```

Readonly mounts are useful for rendering endpoints that only read the session.
Assignments are ignored with a console warning, and `isModified` changes are
never saved.

For typed access, parameterize the service and annotate the handler context with
`SessionContext<TData>`:

```ts
import { session, type SessionContext, type SessionInstance } from "rossa";

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

`SessionAuthInterface<AccountSession>` returns `SessionInstance<AccountSession>`
from `openSession`, `loadHeader`, and related methods, so the data properties are
typed without casts. Untyped mounts keep the previous `Record<string, any>`
behavior. `SessionConfig` remains an alias for the `SessionMount` object form.

## SQLite auth service example

This concrete service stores sessions in SQLite with Bun's SQL client. The
interface provides signing, cookie creation, expiration checks, and session
objects; the service implements database reads and writes.

```ts
import { SQL } from "bun";
import {
  DbRepository,
  DbSchema,
  SessionAuthInterface,
  sqliteDialect,
  t,
  type AuthConfig,
} from "rossa";
import type { ServerSide } from "rossa";

interface SessionRow {
  id: string;
  data: Record<string, any>;
  expiration: string;
}

export class AppSessionAuthService extends SessionAuthInterface {
  private readonly sessions: DbRepository<SessionRow>;

  constructor(
    db: SQL,
    config: AuthConfig,
    secret: string,
  ) {
    super(config, secret);
    const schema = new DbSchema<SessionRow>(
      "sessions",
      {
        id: t.text().primary,
        data: t.json().notNull,
        expiration: t.text().notNull,
      },
      sqliteDialect,
    );
    this.sessions = new DbRepository(db, schema);
  }

  async init(): Promise<void> {
    await this.sessions.create();
    await this.sessions.syncColumns();
  }

  override async fetchData(id: string): Promise<SessionRow | undefined> {
    return (await this.sessions.find({ id })) ?? undefined;
  }

  override async saveSession(
    session: ServerSide,
    headers: Headers,
  ): Promise<void> {
    await this.sessions.upsert(
      {
        id: session.sid,
        data: session.data,
        expiration: this.getSessionExpirationDate.toISOString(),
      },
      "id",
    );
    this.setCookie(session, headers);
  }

  override async deleteSession(
    session: ServerSide,
    headers: Headers,
  ): Promise<void> {
    if (session.isFound) await this.sessions.delete({ id: session.sid });
    this.removeCookie(session, headers);
  }
}
```

Create a Bun SQL connection with `new SQL("sqlite://sessions.sqlite")`, pass
it to the service, call `init()` before serving requests, then register it with
`app.use(session(sessions))`. Keep the signing secret private and stable across
restarts. For multi-instance deployments, use a shared database accessible to
all instances.

```ts
const db = new SQL("sqlite://sessions.sqlite");
const sessions = new AppSessionAuthService(
  db,
  { COOKIE_SECURE: true, COOKIE_HTTPONLY: true },
  process.env.SESSION_SECRET!,
);
await sessions.init();
app.use(session(sessions));
```
