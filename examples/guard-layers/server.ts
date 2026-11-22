import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import {
  JWTAuthService,
  Methods,
  Rossa,
  SessionAuthInterface,
  apiKey,
  contentType,
  createGuard,
  csrf,
  ipFilter,
  json,
  jwtAuth,
  loggerFN,
  multipart,
  rateLimit,
  requireSession,
  route,
  sanitize,
  security,
  sendError,
  session,
  staticFiles,
  timeout,
  use,
  z,
} from "../../src/index";
import type {
  AuthConfig,
  JwtRefreshTokenStore,
  ServerSide,
  ctx,
} from "../../src/index";

const INDEX_FILE = Bun.file(join(import.meta.dir, "index.html"));

/* -------------------------------------------------------------------------- */
/*  Demo configuration                                                        */
/* -------------------------------------------------------------------------- */

const LOOPBACK_IPS = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
const OFFICE_IPS = ["10.20.30.0/24"];
const PROVIDER_IPS = ["203.0.113.0/24", "198.51.100.10"];

const ADMIN_ALLOWED_IPS = [...LOOPBACK_IPS, ...OFFICE_IPS];
const PROVIDER_ALLOWED_IPS = [...LOOPBACK_IPS, ...PROVIDER_IPS];

/**
 * Mutable allowlists so the playground can demonstrate a real 403 without
 * restarting the server. Each list is replaced, never edited in place, and the
 * `ipFilter` guard reads it on every request.
 */
const adminIpPolicy: { whitelist: string[] } = {
  whitelist: [...ADMIN_ALLOWED_IPS],
};
const providerIpPolicy: { whitelist: string[] } = {
  whitelist: [...PROVIDER_ALLOWED_IPS],
};

const WEBHOOK_SECRET = "whsec_demo_guard_layers";
const WEBHOOK_MAX_SKEW_SECONDS = 5 * 60;
const PARTNER_WINDOW_MS = 10_000;
const MAX_AVATAR_BYTES = 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];

/* -------------------------------------------------------------------------- */
/*  JWT service (public API only: issue/verify via guards)                    */
/* -------------------------------------------------------------------------- */

/** Volatile refresh-token store used by the admin JWT scenario. */
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

/* -------------------------------------------------------------------------- */
/*  Scenario 1 — Admin panel: JWT → role → IP → audit                         */
/* -------------------------------------------------------------------------- */

type Role = "admin" | "member";

/** Claims are nested so the role guard can read `ctx.jwtData.claims`. */
type DemoClaims = {
  claims: {
    userId: number;
    email: string;
    role: Role;
  };
};

const jwt = new JWTAuthService<DemoClaims>(
  new MemoryRefreshStore(),
  "guard-layers-demo-jwt-secret",
);

type ClaimsView = { claims?: { userId?: number; email?: string; role?: Role } };

const adminUsers: Record<
  string,
  { id: number; email: string; password: string; role: Role }
> = {
  "admin@example.com": {
    id: 1,
    email: "admin@example.com",
    password: "admin-demo",
    role: "admin",
  },
  "member@example.com": {
    id: 2,
    email: "member@example.com",
    password: "member-demo",
    role: "member",
  },
};

const AdminLoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Issues a demo JWT pair after checking the seeded admin/member credentials.
 * No authentication guard is needed before login: this route is the entry point.
 */
@route("/admin/login")
@use(json(AdminLoginBody))
class AdminLoginRoute extends Methods {
  async post({ req, res }: ctx) {
    const body = (await req.json()) as z.infer<typeof AdminLoginBody>;
    const user = adminUsers[body.email.toLowerCase()];
    if (!user || user.password !== body.password) {
      return sendError({ code: 401, message: "Invalid email or password" });
    }

    const tokens = await jwt.issue({
      claims: { userId: user.id, email: user.email, role: user.role },
    });

    return res.json({
      ok: true,
      role: user.role,
      claims: { userId: user.id, email: user.email, role: user.role },
      ...tokens,
    });
  }
}

/**
 * Requires the authenticated JWT claim `role` to match the configured role.
 * Reads `ctx.jwtData.claims`, which `jwtAuth` populated.
 */
const requireRole = createGuard<Role>(
  async (ctx, next, role, config) => {
    const actual = (ctx.jwtData as ClaimsView).claims?.role;
    if (actual !== role) return sendError(config);
    return next();
  },
  { id: "require-role", code: 403, message: "Forbidden: insufficient role" },
);

interface AuditEntry {
  at: string;
  actor: string;
  role: string;
  ip: string;
  method: string;
  path: string;
}

const auditTrail: AuditEntry[] = [];

/**
 * Appends one structured entry for each request that reached the fully
 * approved admin stack. This guard never denies; it is the observability layer
 * and intentionally runs last so blocked requests are not recorded as approved.
 */
const auditLog = createGuard<void>(
  async (ctx, next) => {
    const claims = (ctx.jwtData as ClaimsView).claims;
    auditTrail.push({
      at: new Date().toISOString(),
      actor: claims?.email ?? "unknown",
      role: claims?.role ?? "unknown",
      ip: ctx.req.ip?.address ?? "unknown",
      method: ctx.req.method,
      path: ctx.req.url.pathname,
    });
    if (auditTrail.length > 100) auditTrail.shift();
    return next();
  },
  { id: "audit-log" },
);

/**
 * GET /admin/panel — layer order:
 *   jwtAuth (401) → requireRole("admin") (403) → ipFilter (403) → auditLog.
 *
 * Authentication runs before authorization so the role check always has a
 * verified identity. Authorization runs before the network policy because
 * permissions belong to the identity, not to the address. The audit layer runs
 * last so only fully approved requests are recorded.
 */
@route("/admin/panel")
@use(jwtAuth(jwt), requireRole("admin"), ipFilter(adminIpPolicy), auditLog())
class AdminPanelRoute extends Methods {
  get({ jwtData, req, res }: ctx) {
    const claims = (jwtData as ClaimsView).claims;
    return res.json({
      ok: true,
      panel: "admin",
      actor: claims,
      ip: req.ip?.address ?? null,
      layers: ["jwtAuth", "requireRole(admin)", "ipFilter", "auditLog"],
    });
  }
}

/** Read-only view of the last 100 approved admin requests. */
@route("/admin/audit")
@use(jwtAuth(jwt), requireRole("admin"))
class AdminAuditRoute extends Methods {
  get({ res }: ctx) {
    return res.json({
      ok: true,
      count: auditTrail.length,
      entries: [...auditTrail].reverse().slice(0, 20),
      note: "Only requests that passed JWT, role, and IP policy are recorded.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Demo-only network policy control (used by the playground + README)        */
/* -------------------------------------------------------------------------- */

const IpPolicyBody = z.object({
  target: z.string(),
  allowLoopback: z.boolean(),
});

/**
 * Playground control: flips one scenario's IP allowlist so the 403 path can be
 * exercised from loopback. Admin-only on purpose; a production app would never
 * expose a runtime control like this.
 */
@route("/demo/ip-policy")
@use(jwtAuth(jwt), requireRole("admin"), json(IpPolicyBody))
class DemoIpPolicyRoute extends Methods {
  async post({ req, res }: ctx) {
    const body = (await req.json()) as z.infer<typeof IpPolicyBody>;

    if (body.target === "admin") {
      adminIpPolicy.whitelist = body.allowLoopback
        ? [...ADMIN_ALLOWED_IPS]
        : [...OFFICE_IPS];
    } else if (body.target === "provider") {
      providerIpPolicy.whitelist = body.allowLoopback
        ? [...PROVIDER_ALLOWED_IPS]
        : [...PROVIDER_IPS];
    } else {
      return sendError({
        code: 400,
        message: "target must be 'admin' or 'provider'",
      });
    }

    return res.json({
      ok: true,
      target: body.target,
      allowLoopback: body.allowLoopback,
      adminWhitelist: adminIpPolicy.whitelist,
      providerWhitelist: providerIpPolicy.whitelist,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Scenario 2 — Account settings: session → auth → CSRF → schema → rate limit*/
/* -------------------------------------------------------------------------- */

interface SessionRow {
  data: Record<string, unknown>;
  expiration: string;
}

/** In-memory session store; the example needs no database. */
class MemorySessions extends SessionAuthInterface {
  private readonly rows = new Map<string, SessionRow>();

  constructor(config: AuthConfig) {
    super(config, "guard-layers-demo-session-salt");
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
  COOKIE_NAME: "guard_layers_sid",
  COOKIE_PATH: "/api/account",
  COOKIE_SECURE: false,
  COOKIE_SAMESITE: "Lax",
});

const accountUsers: Record<
  string,
  { id: number; email: string; password: string; displayName: string }
> = {
  "ada@example.com": {
    id: 10,
    email: "ada@example.com",
    password: "correct-horse",
    displayName: "Ada Lovelace",
  },
  "grace@example.com": {
    id: 11,
    email: "grace@example.com",
    password: "hopper-demo",
    displayName: "Grace Hopper",
  },
};

type AccountSession = {
  userId?: number;
  email?: string;
  displayName?: string;
};

const AccountLoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/account/login — rate limit runs first so credential-stuffing
 * attempts are rejected before JSON parsing. On success the session guard
 * persists the new session and a readable CSRF cookie is issued for the
 * state-changing account routes.
 */
@route("/api/account/login")
@use(
  rateLimit({ max: 5, windowMs: 15_000 }),
  session(sessions),
  json(AccountLoginBody),
)
class AccountLoginRoute extends Methods {
  async post({ req, session: current, res }: ctx) {
    const body = (await req.json()) as z.infer<typeof AccountLoginBody>;
    const user = accountUsers[body.email.toLowerCase()];
    if (!user || user.password !== body.password) {
      return sendError({ code: 401, message: "Invalid email or password" });
    }

    const data = current as unknown as AccountSession;
    data.userId = user.id;
    data.email = user.email;
    data.displayName = user.displayName;

    const csrfToken = crypto.randomUUID();
    return res
      .header({
        "Set-Cookie": `csrf_token=${csrfToken}; Path=/; SameSite=Lax`,
      })
      .json({
        ok: true,
        csrfToken,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
        sessionCookie: "guard_layers_sid (Path=/api/account)",
      });
  }
}

const SettingsBody = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(40),
});

/**
 * POST /api/account/settings — layer order:
 *   session (loads cookie) → requireSession (401) → csrf (403) →
 *   json(schema) (400/415) → rateLimit (429).
 *
 * The session must be resolved before CSRF because an anonymous request has no
 * identity to protect. `requireSession` is the framework guard (a stored,
 * unexpired session) and its validator requires the `userId` written at login.
 * CSRF runs before body parsing so a cross-site write is
 * rejected without paying parse/validation cost. The schema rejects malformed
 * updates before the small authenticated-write budget is consumed, and the
 * limiter runs last to protect the account mutation itself.
 */
@route("/api/account/settings")
@use(
  session(sessions),
  requireSession((s) => typeof (s as AccountSession).userId === "number"),
  csrf(),
  json(SettingsBody),
  rateLimit({ max: 5, windowMs: 10_000 }),
)
class AccountSettingsRoute extends Methods {
  async post({ session: current, req, res }: ctx) {
    const body = (await req.json()) as z.infer<typeof SettingsBody>;
    const data = current as unknown as AccountSession;
    data.email = body.email;
    data.displayName = body.displayName;

    return res.json({
      ok: true,
      user: { email: body.email, displayName: body.displayName },
      note: "The session guard persists these fields after the handler returns.",
      layers: ["session", "requireSession", "csrf", "json", "rateLimit"],
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Scenario 3 — Partner API: API key → tier quota → timeout                  */
/* -------------------------------------------------------------------------- */

type Tier = "gold" | "silver";

const partnerKeys: Record<string, { tier: Tier; label: string }> = {
  "partner-gold-key": { tier: "gold", label: "Acme (gold)" },
  "partner-silver-key": { tier: "silver", label: "Globex (silver)" },
};

/**
 * Resolves the API key to a partner and stores the tier on `ctx.data` for the
 * next guard. Unknown keys return 401 from the built-in `apiKey` guard.
 */
const lookupPartner = (ctx: ctx, key?: string): boolean => {
  const partner = key ? partnerKeys[key] : undefined;
  if (!partner) return false;
  ctx.data.tier = partner.tier;
  ctx.data.partner = partner.label;
  return true;
};

const tierLimits: Record<Tier, { max: number; windowMs: number }> = {
  gold: { max: 10, windowMs: PARTNER_WINDOW_MS },
  silver: { max: 3, windowMs: PARTNER_WINDOW_MS },
};

const tierBuckets = new Map<string, { count: number; reset: number }>();

/**
 * Per-tier quota keyed by partner + tier. Runs after `apiKey` because the tier
 * does not exist until the key is validated; unknown keys must never allocate
 * quota counters. Gold gets 10 requests / 10s, silver 3 / 10s.
 */
const tierQuota = createGuard<void>(
  async (ctx, next, _options, config) => {
    const tier = ctx.data.tier as Tier | undefined;
    if (!tier) {
      return sendError({
        ...config,
        code: 401,
        message: "Partner tier was not resolved",
      });
    }

    const limit = tierLimits[tier];
    const key = `${ctx.data.partner as string}:${tier}`;
    const now = Date.now();
    let bucket = tierBuckets.get(key);
    if (!bucket || bucket.reset <= now) {
      bucket = { count: 0, reset: now + limit.windowMs };
      tierBuckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > limit.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.reset - now) / 1000));
      return sendError({
        ...config,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(limit.max),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Tier": tier,
        },
      });
    }

    const response = await next();
    response.headers.set("X-RateLimit-Limit", String(limit.max));
    response.headers.set(
      "X-RateLimit-Remaining",
      String(Math.max(0, limit.max - bucket.count)),
    );
    response.headers.set("X-RateLimit-Tier", tier);
    return response;
  },
  { id: "partner-tier-quota", code: 429, message: "Partner quota exceeded" },
);

/**
 * GET /partner/v1/data — layer order:
 *   apiKey (401) → tierQuota (429) → timeout(200) (408).
 *
 * The key is validated first because tier-based quota needs the key's tier;
 * unknown traffic must not create quota buckets. The quota then sheds load
 * before handler work. Timeout wraps only the downstream handler so it measures
 * handler latency rather than authentication overhead. `?slow=1` demonstrates
 * the 408 path; it is not part of normal traffic.
 */
@route("/partner/v1/data")
@use(apiKey(lookupPartner), tierQuota(), timeout(200))
class PartnerDataRoute extends Methods {
  async get({ data, url, res }: ctx) {
    if (url.searchParams.get("slow") === "1") await Bun.sleep(350);
    return res.json({
      ok: true,
      tier: data.tier,
      partner: data.partner,
      data: { records: 3, region: "eu-west-1" },
      layers: ["apiKey", "tierQuota", "timeout(200)"],
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Scenario 4 — Avatar upload: session → type → multipart → file → sanitize  */
/* -------------------------------------------------------------------------- */

/**
 * Validates the single `avatar` File in `ctx.form`: PNG/JPEG/WebP and at most
 * 1 MiB. Runs after `multipart()` so the parsed file exists, and before
 * `sanitize()` so rejecting a bad upload never rewrites text fields.
 */
const validateAvatar = createGuard<void>(
  async (ctx, next, _options) => {
    const raw = ctx.form.avatar;

    if (Array.isArray(raw)) {
      return sendError({
        code: 400,
        message: "Upload exactly one avatar file",
      });
    }
    if (!(raw instanceof File)) {
      return sendError({ code: 400, message: "avatar file field is required" });
    }
    if (!ALLOWED_AVATAR_TYPES.includes(raw.type)) {
      return sendError({
        code: 415,
        message: "avatar must be image/png, image/jpeg, or image/webp",
      });
    }
    if (raw.size > MAX_AVATAR_BYTES) {
      return sendError({
        code: 413,
        message: "avatar must be 1 MiB or smaller",
      });
    }

    return next();
  },
  { id: "avatar-file-validation", code: 400 },
);

/**
 * POST /api/account/avatar — layer order:
 *   session → requireSession (401) → contentType (415) → multipart (400) →
 *   validateAvatar (413/415/400) → sanitize.
 *
 * Authentication runs first so anonymous uploads never pay multipart parsing
 * cost. `contentType` rejects unsupported encodings before the parser allocates
 * form data; `multipart` then creates `ctx.form` for validation. File checks
 * come before `sanitize` so an invalid file is rejected before any text fields
 * are rewritten. Nothing is written to disk.
 */
@route("/api/account/avatar")
@use(
  session(sessions),
  requireSession((s) => typeof (s as AccountSession).userId === "number"),
  contentType("multipart/form-data"),
  multipart(),
  validateAvatar(),
  sanitize({ query: false, form: true }),
)
class AccountAvatarRoute extends Methods {
  post({ form, res }: ctx) {
    const avatar = form.avatar as File;
    return res.json({
      ok: true,
      name: avatar.name,
      size: avatar.size,
      type: avatar.type,
      fields: {
        caption: (form.caption as string | undefined) ?? "",
        bio: (form.bio as string | undefined) ?? "",
      },
      note: "Text fields are HTML-escaped by sanitize(); the file is not stored.",
      layers: [
        "session",
        "requireSession",
        "contentType",
        "multipart",
        "validateAvatar",
        "sanitize",
      ],
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Scenario 5 — Payment webhook: signature → IP → replay → schema            */
/* -------------------------------------------------------------------------- */

const seenWebhookBodies = new Map<string, number>();

/**
 * Verifies `x-signature` as the lowercase HMAC-SHA256 hex digest of the raw
 * request body. `ctx.req.text()` caches the bytes, so the replay guard and the
 * `json` guard can read the same body without locking or consuming it twice.
 */
const hmacSignature = createGuard<void>(
  async (ctx, next, _options, config) => {
    const signature = ctx.req.headers.get("x-signature")?.trim();
    if (!signature) return sendError(config);

    const raw = await ctx.req.text();
    const expected = createHmac("sha256", WEBHOOK_SECRET)
      .update(raw)
      .digest("hex");

    const expectedBuffer = Buffer.from(expected, "utf8");
    const providedBuffer = Buffer.from(signature.toLowerCase(), "utf8");
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      return sendError(config);
    }

    ctx.data.rawBody = raw;
    return next();
  },
  {
    id: "webhook-hmac-signature",
    code: 401,
    message: "Invalid webhook signature",
  },
);

/**
 * Rejects payloads whose Unix-second `timestamp` is more than 5 minutes from
 * now, or whose raw-body hash was already accepted. Hashes expire after the
 * same window so the in-memory store stays bounded.
 */
const webhookReplay = createGuard<void>(
  async (ctx, next, _options, config) => {
    const raw =
      (ctx.data.rawBody as string | undefined) ?? (await ctx.req.text());

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return sendError({
        ...config,
        message: "Webhook body must be valid JSON",
      });
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return sendError({
        ...config,
        message: "Webhook body must be a JSON object",
      });
    }

    const timestamp = (parsed as Record<string, unknown>).timestamp;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
      return sendError({
        ...config,
        message: "timestamp (Unix seconds) is required",
      });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (timestamp < nowSeconds - WEBHOOK_MAX_SKEW_SECONDS) {
      return sendError({
        ...config,
        message: "timestamp is too old (maximum skew is 5 minutes)",
      });
    }
    if (timestamp > nowSeconds + WEBHOOK_MAX_SKEW_SECONDS) {
      return sendError({
        ...config,
        message: "timestamp is too far in the future",
      });
    }

    const now = Date.now();
    for (const [hash, expiresAt] of seenWebhookBodies) {
      if (expiresAt <= now) seenWebhookBodies.delete(hash);
    }

    const hash = createHash("sha256").update(raw).digest("hex");
    if (seenWebhookBodies.has(hash)) {
      return sendError({ ...config, message: "Replayed webhook body" });
    }
    seenWebhookBodies.set(hash, now + WEBHOOK_MAX_SKEW_SECONDS * 1000);

    ctx.data.webhookTimestamp = timestamp;
    return next();
  },
  { id: "webhook-replay", code: 400, message: "Invalid webhook payload" },
);

const PaymentBody = z.object({
  eventId: z.string(),
  amount: z.coerce.number().min(0),
});

/**
 * POST /webhooks/payments — layer order:
 *   hmacSignature (401) → ipFilter (403) → webhookReplay (400) →
 *   json(schema) (400/415).
 *
 * Signature verification must run before schema validation because the HMAC is
 * computed over the raw bytes, not the parsed object. It also rejects forged
 * traffic before IP and replay work. The provider IP allowlist is the second
 * trust boundary. Replay protection runs after IP filtering so only trusted
 * provider traffic can touch the in-memory hash cache. Schema validation runs
 * last, once authenticity, origin, and freshness are established.
 */
@route("/webhooks/payments")
@use(
  hmacSignature(),
  ipFilter(providerIpPolicy),
  webhookReplay(),
  json(PaymentBody),
)
class PaymentWebhookRoute extends Methods {
  async post({ data, req, res }: ctx) {
    const body = (await req.json()) as z.infer<typeof PaymentBody>;
    return res.json({
      ok: true,
      received: {
        eventId: body.eventId,
        amount: body.amount,
        amountType: typeof body.amount,
        timestamp: data.webhookTimestamp,
      },
      layers: ["hmacSignature", "ipFilter", "webhookReplay", "json"],
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
  AdminLoginRoute,
  AdminPanelRoute,
  AdminAuditRoute,
  DemoIpPolicyRoute,
  AccountLoginRoute,
  AccountSettingsRoute,
  PartnerDataRoute,
  AccountAvatarRoute,
  PaymentWebhookRoute,
  PlaygroundPage,
);

await jwt.init();

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8791);
  const server = app.serve({ port });
  console.log(
    `Guard layers playground listening on http://localhost:${server.port}`,
  );
}
