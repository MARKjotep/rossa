import { describe, expect, it } from "bun:test";
import {
  errorHandler,
  Methods,
  Rossa,
  route,
  security,
  sendError,
  session,
  urlencoded,
  jwtRotate,
  JwtEngine,
  JWTAuthService,
  SessionAuthInterface,
  createGuard,
} from "../../src/index";
import type {
  BaseConfig,
  ErrorConfig,
  JwtInspection,
  JwtRefreshTokenStore,
  RefreshConsumeResult,
  RefreshRejectionReason,
  SessionContext,
  SessionGuard,
  SessionInstance,
  SessionMount,
  UrlencodedOptions,
} from "../../src/index";
import type { ctx } from "../../src/http/ctx";

@route("/docs-shapes")
class DocsShapeController extends Methods {
  get({ res }: ctx): Response {
    return res.json({ ok: true });
  }
}

@route("/docs-shapes-fails")
class DocsShapeFailingController extends Methods {
  get(): Response {
    throw new Error("private failure details");
  }
}

/** Compile-time proof that the documented types import from the package root. */
type AccountSession = { userId: string };

const _typedSession = (ctx: SessionContext<AccountSession>) => ctx.session?.userId;
const _mount: SessionMount<AccountSession> = {
  auth: undefined as unknown as SessionAuthInterface<AccountSession>,
  readonly: true,
};
const _typedGuard = undefined as unknown as SessionGuard<AccountSession>;
const _instance = undefined as unknown as SessionInstance<AccountSession>;
const _urlencodedOptions: UrlencodedOptions = { strict: true };
const _baseConfig: BaseConfig = { code: 422 };
const _errorConfig: ErrorConfig = { message: "nope" };
const _reason: RefreshRejectionReason = "reused";
const _consume: RefreshConsumeResult<AccountSession> = {
  ok: false,
  reason: _reason,
};
const _inspection = undefined as unknown as JwtInspection<AccountSession>;
const _store: JwtRefreshTokenStore = {
  save: async () => {},
  consume: async () => false,
  deleteExpired: async () => 0,
};
void [
  _typedSession,
  _mount,
  _typedGuard,
  _instance,
  _urlencodedOptions,
  _baseConfig,
  _errorConfig,
  _consume,
  _inspection,
  _store,
];

describe("documented rejection shapes", () => {
  it("applies the documented default security header set", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.use(security());
    app.register(DocsShapeController);

    const response = await app.test(
      new Request("http://localhost/docs-shapes"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");

    // Opt-in headers stay absent unless configured.
    expect(response.headers.has("content-security-policy")).toBe(false);
    expect(response.headers.has("strict-transport-security")).toBe(false);
  });

  it("sets opt-in headers and disables defaults with false", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.use(
      security({
        contentSecurityPolicy: "default-src 'none'",
        hsts: "max-age=31536000; includeSubDomains",
        xFrameOptions: false,
      }),
    );
    app.register(DocsShapeController);

    const response = await app.test(
      new Request("http://localhost/docs-shapes"),
    );

    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'",
    );
    expect(response.headers.get("strict-transport-security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(response.headers.has("x-frame-options")).toBe(false);
  });

  it("answers OPTIONS on a declared path with 204 and Allow, and 404s elsewhere", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(DocsShapeController);

    const options = await app.test(
      new Request("http://localhost/docs-shapes", { method: "OPTIONS" }),
    );
    expect(options.status).toBe(204);
    expect(options.headers.get("allow")).toBe("GET, OPTIONS");
    expect(await options.text()).toBe("");

    const undeclared = await app.test(
      new Request("http://localhost/not-declared", { method: "OPTIONS" }),
    );
    expect(undeclared.status).toBe(404);
  });

  it("returns 404 for HEAD when no head handler is implemented", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.register(DocsShapeController);

    const head = await app.test(
      new Request("http://localhost/docs-shapes", { method: "HEAD" }),
    );
    expect(head.status).toBe(404);
  });

  it("returns a plain-text 500 from the errorHandler guard", async () => {
    const app = new Rossa({ Encoding: "none" });
    app.use(errorHandler());
    app.register(DocsShapeFailingController);

    const response = await app.test(
      new Request("http://localhost/docs-shapes-fails"),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await response.text()).toBe("Internal Server Error");
  });

  it("keeps sendError JSON while leaving CORS to the cors guard", async () => {
    const response = sendError({ code: 403, message: "Forbidden" });

    expect(
      response.headers.get("content-type")?.startsWith("application/json"),
    ).toBe(true);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(await response.json()).toEqual({
      success: false,
      error: "Forbidden",
    });
  });
});

describe("new public APIs import from the package root", () => {
  it("exposes the documented runtime exports", () => {
    expect(typeof createGuard).toBe("function");
    expect(typeof jwtRotate).toBe("function");
    expect(typeof session).toBe("function");
    expect(typeof urlencoded).toBe("function");
    expect(typeof security).toBe("function");
    expect(typeof errorHandler).toBe("function");
    expect(typeof sendError).toBe("function");
    expect(typeof JwtEngine).toBe("function");
    expect(typeof JWTAuthService).toBe("function");
    expect(typeof SessionAuthInterface).toBe("function");
  });
});
