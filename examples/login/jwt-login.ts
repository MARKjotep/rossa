import { SQL } from "bun";
import {
  DbRepository,
  JWTAuthService,
  Methods,
  Rossa,
  Schema,
  jwtAuth,
  jwtRefresh,
  route,
  sqliteDialect,
  t,
  use,
} from "../../src/index";
import type { JwtRefreshTokenStore } from "../../src/auth/jwt/jwt-service";
import type { ctx } from "../../src/index";

interface UserRow {
  id: number;
  email: string;
  passwordHash: string;
}
interface RefreshRow {
  token: string;
  expiresAt: number;
}
type Claims = { userId: number; email: string };

const db = new SQL(process.env.DATABASE_URL ?? "sqlite://login-jwt.sqlite");
const users = new DbRepository(
  db,
  new Schema<UserRow>(
    "users",
    {
      id: t.serial().primary,
      email: t.text().notNull.unique,
      passwordHash: t.text().notNull,
    },
    sqliteDialect,
  ),
);
const refreshRows = new DbRepository(
  db,
  new Schema<RefreshRow>(
    "refresh_tokens",
    {
      token: t.text().primary,
      expiresAt: t.bigint().notNull,
    },
    sqliteDialect,
  ),
);

const refreshStore: JwtRefreshTokenStore = {
  async initialize() {
    await refreshRows.create();
    await refreshRows.syncColumns();
  },
  async save(token, expiresAt) {
    await refreshRows.upsert({ token, expiresAt }, "token");
  },
  async consume(token) {
    const row = await refreshRows.find({ token });
    if (!row || row.expiresAt <= Date.now()) {
      if (row) await refreshRows.delete({ token });
      return false;
    }
    // DELETE returns the rows it removed; only one concurrent caller succeeds.
    return (await refreshRows.delete({ token })).length === 1;
  },
};

const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error("Set AUTH_SECRET to a long random secret.");
const tokens = new JWTAuthService<Claims>(refreshStore, secret);

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
      const passwordHash = await Bun.password.hash(body.password);
      const user = await users.insert({ email, passwordHash } as UserRow);
      return res.status(201).json({ user: { id: user?.id, email } });
    } catch {
      return res.error(409, "Email is already registered.");
    }
  }
}

@route("/auth/login")
class LoginRoute extends Methods {
  async post({ req, res }: ctx) {
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
    const claims = { userId: user.id, email: user.email };
    return res.json({ user: claims, ...(await tokens.issue(claims)) });
  }
}

@route("/auth/me")
@use(jwtAuth(tokens))
class MeRoute extends Methods {
  get({ jwtData, res }: ctx) {
    return res.json({ user: { id: jwtData.userId, email: jwtData.email } });
  }
}

@route("/auth/refresh")
@use(jwtRefresh(tokens))
class RefreshRoute extends Methods {
  post({ data, jwtData, res }: ctx) {
    return res.json({
      user: { id: jwtData.userId, email: jwtData.email },
      ...data.jwtTokens,
    });
  }
}

await Promise.all([users.create(), tokens.init()]);
const app = new Rossa({ Encoding: "none" });
app.register(RegisterRoute, LoginRoute, MeRoute, RefreshRoute);
const server = app.serve({ hostname: "127.0.0.1", port: 3001 });
console.log(`JWT login example listening on http://127.0.0.1:${server.port}`);
