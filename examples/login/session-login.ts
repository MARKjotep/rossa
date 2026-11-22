import { SQL } from "bun";
import {
  DbRepository,
  Methods,
  Rossa,
  DbSchema,
  ServerSide,
  SessionAuthInterface,
  route,
  session,
  sqliteDialect,
  t,
} from "../../src/index";
import type { AuthConfig, ctx } from "../../src/index";

interface UserRow {
  id: number;
  email: string;
  passwordHash: string;
}

interface SessionRow {
  id: string;
  data: Record<string, any>;
  expiration: string;
}

const db = new SQL(
  process.env.DATABASE_URL ?? "sqlite://login-sessions.sqlite",
);
const users = new DbRepository(
  db,
  new DbSchema<UserRow>(
    "users",
    {
      id: t.serial().primary,
      email: t.text().notNull.unique,
      passwordHash: t.text().notNull,
    },
    sqliteDialect,
  ),
);

class SqliteSessions extends SessionAuthInterface {
  private readonly rows = new DbRepository(
    db,
    new DbSchema<SessionRow>(
      "sessions",
      {
        id: t.text().primary,
        data: t.json().notNull,
        expiration: t.text().notNull,
      },
      sqliteDialect,
    ),
  );

  constructor(config: AuthConfig, secret: string) {
    super(config, secret);
  }

  async init() {
    await this.rows.create();
    await this.rows.syncColumns();
  }

  async fetchData(id: string) {
    return (await this.rows.find({ id })) ?? undefined;
  }

  async saveSession(current: ServerSide, headers: Headers) {
    await this.rows.upsert(
      {
        id: current.sid,
        data: current.data,
        expiration: this.getSessionExpirationDate.toISOString(),
      },
      "id",
    );
    this.setCookie(current, headers);
  }

  async deleteSession(current: ServerSide, headers: Headers) {
    if (current.isFound) await this.rows.delete({ id: current.sid });
    this.removeCookie(current, headers);
  }
}

const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error("Set AUTH_SECRET to a long random secret.");

@route("/auth/register")
class RegisterRoute extends Methods {
  async post({ req, res }: ctx) {
    const body = await req.json<{ email?: string; password?: string }>();
    const email = body.email?.trim().toLowerCase();
    if (!email || !body.password || body.password.length < 12) {
      return res.error(
        400,
        "Provide an email and a password of at least 12 characters.",
      );
    }
    try {
      const user = await users.insert({
        email,
        passwordHash: await Bun.password.hash(body.password),
      } as UserRow);
      return res.status(201).json({ user: { id: user?.id, email } });
    } catch {
      return res.error(409, "Email is already registered.");
    }
  }
}

@route("/auth/login")
class LoginRoute extends Methods {
  async post({ req, res, session: current }: ctx) {
    const body = await req.json<{ email?: string; password?: string }>();
    const user = body.email
      ? await users.find({ email: body.email.trim().toLowerCase() })
      : null;
    if (
      !user ||
      !body.password ||
      !(await Bun.password.verify(body.password, user.passwordHash))
    ) {
      return res.error(401, "Invalid email or password.");
    }
    if (!current)
      return res.error(500, "Session middleware is not configured.");
    // The session guard detects this mutation and calls saveSession after the
    // handler returns; no route-level database write is needed.
    (current as any).userID = user.id;
    (current as any).email = user.email;
    return res.json({ user: { id: user.id, email: user.email } });
  }
}

@route("/auth/me")
class MeRoute extends Methods {
  get({ res, session: current }: ctx) {
    if (!(current as any)?.userID) return res.error(401, "Not logged in.");
    return res.json({
      user: { id: (current as any).userID, email: (current as any).email },
    });
  }
}

const sessions = new SqliteSessions({ COOKIE_SECURE: false }, secret);
await Promise.all([users.create(), sessions.init()]);
const app = new Rossa();
app.use(session(sessions));
app.register(RegisterRoute, LoginRoute, MeRoute);
const server = app.serve({ hostname: "127.0.0.1", port: 3000 });
console.log(
  `Session login example listening on http://127.0.0.1:${server.port}`,
);
