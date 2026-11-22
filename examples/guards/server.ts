import { join } from "node:path";
import {
  JWTAuthService,
  Methods,
  Rossa,
  ServerSide,
  SessionAuthInterface,
  apiKey,
  auth,
  authBearer,
  contentType,
  cookies,
  cors,
  createGuard,
  csrf,
  header,
  ipFilter,
  json,
  jwtAuth,
  jwtRefresh,
  keys,
  logger,
  loggerFN,
  multipart,
  rateLimit,
  route,
  sanitize,
  security,
  sendError,
  session,
  smartCache,
  staticFiles,
  timeout,
  urlencoded,
  use,
  validateForm,
  validateQuery,
  validateUrl,
  z,
} from "../../src/index";
import type { ctx, AuthConfig, JwtRefreshTokenStore } from "../../src/index";

const DEMO_API_KEY = "demo-key";
const DEMO_BEARER = "demo-token";
const DEMO_CSRF_COOKIE = "csrf_token";
const INDEX_FILE = Bun.file(join(import.meta.dir, "index.html"));

/* -------------------------------------------------------------------------- */
/*  JSON + keys                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Fields are optional in the schema so a valid JSON body can omit one and let
 * the `keys` guard produce its own "Missing required fields" response. The
 * `json` guard still coerces `count` from a string before `keys` sees it.
 */
const JsonBody = z.object({
  name: z.string().min(1).optional(),
  count: z.coerce.number().min(0).optional(),
});

/** `json` validates/coerces the body; `keys` requires both top-level fields. */
@route("/api/json")
@use(json(JsonBody), keys(["name", "count"]))
class JsonRoute extends Methods {
  post({ body, res }: ctx) {
    const parsed = body as z.infer<typeof JsonBody>;
    return res.json({
      ok: true,
      validated: parsed,
      countType: typeof parsed.count,
      note: "z.coerce.number() converted count before the keys guard ran.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Query / form / multipart                                                  */
/* -------------------------------------------------------------------------- */

const QueryBody = z.object({
  page: z.coerce.number().min(1),
  q: z.string().optional(),
});

/** `validateQuery` coerces string query values and stores them on `ctx.query`. */
@route("/api/query")
@use(validateQuery(QueryBody))
class QueryRoute extends Methods {
  get({ query, res }: ctx) {
    const parsed = query as unknown as z.infer<typeof QueryBody>;
    return res.json({
      ok: true,
      page: parsed.page,
      pageType: typeof parsed.page,
      q: parsed.q ?? null,
      note: "?page=2 arrives as a string and is coerced to a number.",
    });
  }
}

const FormBody = z.object({
  name: z.string().min(2),
  age: z.coerce.number().min(0),
});

/** `urlencoded` parses the body; `validateForm` validates and coerces fields. */
@route("/api/form")
@use(urlencoded(), validateForm(FormBody))
class FormRoute extends Methods {
  post({ form, res }: ctx) {
    const parsed = form as unknown as z.infer<typeof FormBody>;
    return res.json({
      ok: true,
      form: parsed,
      ageType: typeof parsed.age,
      note: "Form fields are strings; age is coerced by the schema.",
    });
  }
}

/** `contentType` enforces multipart; `multipart` parses fields and files. */
@route("/api/upload")
@use(contentType("multipart/form-data"), multipart())
class UploadRoute extends Methods {
  post({ form, res }: ctx) {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form)) {
      fields[key] =
        value instanceof File
          ? { name: value.name, type: value.type, size: value.size }
          : value;
    }
    return res.json({ ok: true, fields });
  }
}

/* -------------------------------------------------------------------------- */
/*  Authentication/header guards                                              */
/* -------------------------------------------------------------------------- */

/** `header` requires `x-api-key` and validates its value with a callback. */
@route("/api/secure")
@use(
  header({ "x-api-key": (_ctx, _name, value) => value === DEMO_API_KEY }),
  logger("x-api-key demo"),
)
class SecureRoute extends Methods {
  get({ res }: ctx) {
    return res.json({ ok: true, guard: "header", note: "x-api-key matched." });
  }
}

/** `authBearer` extracts and validates a `Bearer <token>` Authorization header. */
@route("/api/bearer")
@use(authBearer((_ctx, token) => token === DEMO_BEARER))
class BearerRoute extends Methods {
  get({ res }: ctx) {
    return res.json({
      ok: true,
      guard: "authBearer",
      note: "Bearer token matched.",
    });
  }
}

/** `apiKey` validates the `x-api-key` header specifically. */
@route("/api/key")
@use(apiKey((_ctx, key) => key === DEMO_API_KEY))
class KeyRoute extends Methods {
  get({ res }: ctx) {
    return res.json({ ok: true, guard: "apiKey", note: "API key matched." });
  }
}

/** `auth` validates a map of headers, each with its own predicate. */
@route("/api/auth")
@use(
  auth({
    "x-api-key": (_ctx, value) => value === DEMO_API_KEY,
    "x-role": (_ctx, value) => value === "admin",
  }),
)
class AuthRoute extends Methods {
  get({ res }: ctx) {
    return res.json({ ok: true, guard: "auth", note: "Both headers matched." });
  }
}

/* -------------------------------------------------------------------------- */
/*  Rate limit / timeout                                                      */
/* -------------------------------------------------------------------------- */

const RATE_WINDOW_MS = 10_000;

/** Three requests per 10s window; the fourth returns 429 with Retry-After. */
@route("/api/rate")
@use(rateLimit({ max: 3, windowMs: RATE_WINDOW_MS }))
class RateRoute extends Methods {
  get({ res }: ctx) {
    return res.json({
      ok: true,
      note: "Burst this route; request 4 inside 10s returns 429.",
    });
  }
}

/** `timeout(150)` races the slow handler and returns 408 when it loses. */
@route("/api/timeout")
@use(timeout(150))
class TimeoutRoute extends Methods {
  async get({ url, res }: ctx) {
    const slow = url.searchParams.get("slow") === "1";
    if (slow) await Bun.sleep(500);
    return res.json({
      ok: true,
      mode: slow ? "slow" : "fast",
      note: slow
        ? "This response lost the race; the guard already returned 408."
        : "Fast handler finished before the 150ms timeout.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Sanitize / URL / CORS / IP                                                */
/* -------------------------------------------------------------------------- */

const SanitizeBody = z.object({ text: z.string() });

/** `sanitize` escapes strings in parsed JSON before the handler sees them. */
@route("/api/sanitize")
@use(json(SanitizeBody), keys(["text"]), sanitize())
class SanitizeRoute extends Methods {
  post({ body, res }: ctx) {
    const parsed = body as { text: string };
    return res.json({
      ok: true,
      sanitized: parsed.text,
      note: "HTML-sensitive characters are escaped, not stripped.",
    });
  }
}

/** `validateUrl` enforces an allowed key, duplicates, and a value pattern. */
@route("/api/url")
@use(
  validateUrl({
    allowedKeys: ["ok"],
    noDuplicates: true,
    patterns: { ok: /^[a-z0-9-]+$/ },
  }),
)
class UrlRoute extends Methods {
  get({ req, res }: ctx) {
    return res.json({
      ok: true,
      query: req.query,
      note: "Only ?ok=<lowercase-alnum-dash> is accepted.",
    });
  }
}

/**
 * `cors` echoes local origins, returns `*` for same-origin requests, and
 * rejects any other explicit Origin with 403.
 */
@route("/api/cors")
@use(
  cors({
    origin: (incoming) =>
      incoming === null
        ? "*"
        : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(incoming)
          ? incoming
          : false,
    allowHeaders: ["content-type", "x-demo"],
    methods: ["GET", "OPTIONS"],
    maxAge: 600,
  }),
)
class CorsRoute extends Methods {
  get({ req, res }: ctx) {
    return res.json({ ok: true, origin: req.headers.get("origin") });
  }
}

const LOOPBACK_IPS = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

/** `ipFilter` allowlist: a direct loopback connection passes. */
@route("/api/ip")
@use(ipFilter({ whitelist: LOOPBACK_IPS }))
class IpRoute extends Methods {
  get({ res }: ctx) {
    return res.json({
      ok: true,
      guard: "ipFilter allowlist",
      note: "Remove loopback entries from the allowlist to see 403.",
    });
  }
}

/** Companion route that blocks loopback so the 403 path is live in the demo. */
@route("/api/ip-blocked")
@use(ipFilter({ blacklist: LOOPBACK_IPS }))
class IpBlockedRoute extends Methods {
  get({ res }: ctx) {
    return res.json({ ok: true, note: "Unreachable from loopback by design." });
  }
}

/* -------------------------------------------------------------------------- */
/*  Cookies / cache / csrf                                                    */
/* -------------------------------------------------------------------------- */

/** `cookies("sid")` only checks presence; the handler echoes the value. */
@route("/api/cookies")
@use(cookies("sid"))
class CookieRoute extends Methods {
  get({ req, res }: ctx) {
    return res.json({ ok: true, sid: req.cookies.get("sid") });
  }
}

/** `smartCache` reuses public GET responses for 15s; run twice and compare. */
let cacheRuns = 0;

@route("/api/cache")
@use(smartCache({ ttlMs: 15_000 }))
class CacheRoute extends Methods {
  get({ res }: ctx) {
    cacheRuns += 1;
    return res.json({
      ok: true,
      handlerRuns: cacheRuns,
      generatedAt: new Date().toISOString(),
      note: "A cache hit repeats handlerRuns/generatedAt and skips the handler.",
    });
  }
}

/**
 * `csrf` validates `x-csrf-token` against the `csrf_token` cookie on
 * state-changing methods. GET issues the matching cookie for the demo.
 */
@route("/api/csrf")
@use(csrf())
class CsrfRoute extends Methods {
  get({ res }: ctx) {
    const token = crypto.randomUUID();
    return res
      .header({
        "Set-Cookie": `${DEMO_CSRF_COOKIE}=${token}; Path=/api/csrf; SameSite=Lax; HttpOnly`,
      })
      .json({ ok: true, token });
  }

  post({ res }: ctx) {
    return res.json({ ok: true, note: "CSRF token and cookie matched." });
  }
}

/* -------------------------------------------------------------------------- */
/*  Session / JWT                                                             */
/* -------------------------------------------------------------------------- */

interface SessionRow {
  data: Record<string, unknown>;
  expiration: string;
}

/** In-memory session store: no database needed for the demo. */
class MemorySessions extends SessionAuthInterface {
  private readonly rows = new Map<string, SessionRow>();

  constructor(config: AuthConfig) {
    super(config, "guards-playground-session-salt");
  }

  override async fetchData(sid: string): Promise<SessionRow | undefined> {
    return this.rows.get(sid);
  }

  override async saveSession(
    current: ServerSide,
    headers: Headers,
  ): Promise<void> {
    this.rows.set(current.sid, {
      data: current.data,
      expiration: this.getSessionExpirationDate.toISOString(),
    });
    this.setCookie(current, headers);
  }

  override async deleteSession(
    current: ServerSide,
    headers: Headers,
  ): Promise<void> {
    this.rows.delete(current.sid);
    this.removeCookie(current, headers);
  }
}

const sessions = new MemorySessions({
  COOKIE_NAME: "guards_sid",
  COOKIE_PATH: "/api/session",
  COOKIE_SECURE: false,
  COOKIE_SAMESITE: "Lax",
});

/** `session` loads `ctx.session` and persists mutations after the handler. */
@route("/api/session")
@use(session(sessions))
class SessionRoute extends Methods {
  get({ session: current, res }: ctx) {
    const state = current as unknown as ServerSide & { visits?: number };
    state.visits = (state.visits ?? 0) + 1;
    return res.json({
      ok: true,
      visits: state.visits,
      note: "Run twice: the cookie scoped to /api/session keeps the counter.",
    });
  }
}

type Claims = { userId: number; email: string; role: "admin" | "member" };

/** Volatile refresh-token store so JWT demos need no database. */
class MemoryRefreshStore implements JwtRefreshTokenStore {
  private readonly tokens = new Map<string, number>();

  async save(token: string, expiresAt: number): Promise<void> {
    this.tokens.set(token, expiresAt);
  }

  async consume(token: string): Promise<boolean> {
    const expiresAt = this.tokens.get(token);
    this.tokens.delete(token);
    return expiresAt !== undefined && expiresAt > Date.now();
  }
}

const jwt = new JWTAuthService<Claims>(
  new MemoryRefreshStore(),
  "guards-playground-demo-secret",
);

/** Issues a demo token pair; no credentials are required in this example. */
@route("/api/jwt/login")
class JwtLoginRoute extends Methods {
  async post({ res }: ctx) {
    const tokens = await jwt.issue({
      userId: 7,
      email: "demo@example.com",
      role: "admin",
    });
    return res.json({ ok: true, ...tokens });
  }
}

/** `jwtAuth` verifies the access token and stores claims in `ctx.jwtData`. */
@route("/api/jwt/me")
@use(jwtAuth(jwt))
class JwtMeRoute extends Methods {
  get({ jwtData, res }: ctx) {
    return res.json({ ok: true, claims: jwtData });
  }
}

/** `jwtRefresh` consumes a one-time refresh token and issues a new pair. */
@route("/api/jwt/refresh")
@use(jwtRefresh(jwt))
class JwtRefreshRoute extends Methods {
  post({ data, jwtData, res }: ctx) {
    return res.json({
      ok: true,
      claims: jwtData,
      tokens: data.jwtTokens,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Async guard + async handler                                               */
/* -------------------------------------------------------------------------- */

const ASYNC_GUARD_MS = 80;
const ASYNC_STEP_ONE_MS = 40;
const ASYNC_STEP_TWO_MS = 60;
const MAX_DELAY_MS = 1_000;

/**
 * Async guard: awaits its delay, records the request start and step marker on
 * `ctx.data`, then awaits downstream work. `?delay=N` (0–1000) extends the wait.
 */
const asyncDelay = createGuard<number>(
  async (ctx, next, baseMs = ASYNC_GUARD_MS) => {
    const rawDelay = ctx.req.url.searchParams.get("delay");
    let extra = 0;
    if (rawDelay !== null) {
      if (!/^\d+$/.test(rawDelay)) {
        return sendError({
          code: 400,
          message: "delay must be an integer between 0 and 1000",
        });
      }
      extra = Number(rawDelay);
      if (extra > MAX_DELAY_MS) {
        return sendError({
          code: 400,
          message: "delay must be an integer between 0 and 1000",
        });
      }
    }

    ctx.data.asyncStartedAt = Date.now();
    ctx.data.asyncDelayMs = baseMs + extra;
    await Bun.sleep(baseMs + extra);

    ctx.data.steps = ["guard-delay"];
    return await next();
  },
  { id: "async-delay" },
);

/** Async handler: awaits two sequential steps before composing the response. */
@route("/api/async")
@use(asyncDelay(ASYNC_GUARD_MS))
class AsyncRoute extends Methods {
  async get({ data, res }: ctx) {
    await Bun.sleep(ASYNC_STEP_ONE_MS);
    (data.steps as string[]).push("handler-step-1");
    await Bun.sleep(ASYNC_STEP_TWO_MS);
    (data.steps as string[]).push("handler-step-2");

    return res.json({
      ok: true,
      steps: data.steps,
      waitedMs: Date.now() - (data.asyncStartedAt as number),
      delayMs: data.asyncDelayMs,
      note: "The response is sent only after the guard and both handler awaits finish.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Playground                                                                */
/* -------------------------------------------------------------------------- */

/** Serves the self-contained playground from the same origin as the API. */
@route("/")
class PlaygroundPage extends Methods {
  get({ res }: ctx) {
    return res.file(INDEX_FILE);
  }
}

export const app = new Rossa({
  Encoding: "none",
  clientPath: import.meta.dir,
});

// Global `use` is LIFO (each `use` unshifts). Register the desired outermost
// guard last: loggerFN → security → staticFiles → route-local chain.
app.use(staticFiles());
app.use(security());
app.use(
  loggerFN(
    ({ method, url, res, timestamp }) =>
      `${method} ${url} -> ${res.status} @ ${timestamp}`,
  ),
);

app.register(
  JsonRoute,
  QueryRoute,
  FormRoute,
  UploadRoute,
  SecureRoute,
  BearerRoute,
  KeyRoute,
  AuthRoute,
  RateRoute,
  TimeoutRoute,
  SanitizeRoute,
  UrlRoute,
  CorsRoute,
  IpRoute,
  IpBlockedRoute,
  CookieRoute,
  CacheRoute,
  CsrfRoute,
  SessionRoute,
  JwtLoginRoute,
  JwtMeRoute,
  JwtRefreshRoute,
  AsyncRoute,
  PlaygroundPage,
);

await jwt.init();

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8790);
  const server = app.serve({ port });
  console.log(`Guards playground listening on http://localhost:${server.port}`);
}
