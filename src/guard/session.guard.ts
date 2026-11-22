import type { SessionAuthInterface } from "@/auth/session/auth-interface";
import type {
  ServerSide,
  SessionInstance,
} from "@/auth/session/server-side";

export type { SessionInstance } from "@/auth/session/server-side";
import { sendError } from "@/http/res";
import type { BaseConfig, GuardReturnType } from "./@/base.guard";
import { createGuard } from "./@/base.guard";

/**
 * Object form accepted by {@link session}. A readonly mount loads the session
 * without letting handlers mutate or persist it.
 */
export interface SessionMount<
  TData extends Record<string, any> = Record<string, any>,
> {
  /** Session service used to load, save, and delete sessions. */
  auth: SessionAuthInterface<TData>;
  /** Discard handler writes and skip persistence. Defaults to `false`. */
  readonly?: boolean;
}

/**
 * Legacy name for {@link SessionMount}; kept so existing imports keep
 * compiling.
 */
export type SessionConfig = SessionMount;

/** A session guard with its data shape attached for editor hints. */
export type SessionGuard<TData extends Record<string, any>> =
  GuardReturnType & {
    /** Phantom marker: the session data shape mounted by this guard. */
    readonly __sessionData?: TData;
  };

type NormalizedMount = {
  auth: SessionAuthInterface<any>;
  readonly: boolean;
};

function isMount(value: unknown): value is SessionMount<any> {
  return (
    typeof value === "object" &&
    value !== null &&
    "auth" in value &&
    Boolean((value as SessionMount<any>).auth)
  );
}

const sessionGuard = createGuard<NormalizedMount>(
  async (ctx, next, mount, errorConfig) => {
    const { auth, readonly } = mount;

    // Readonly mounts load the session in read-only mode: the proxy rejects
    // writes and the guard never persists.
    const [sid, loaded] = await auth.loadHeader(ctx.req.request, readonly);

    ctx.session = loaded;
    const current = loaded;

    const response = await next();

    if (current.isReadOnly) return response;

    const shouldDelete =
      current.length === 0 &&
      (current.isNew ? Boolean(sid) : current.isModified);
    const shouldSave =
      !shouldDelete && current.length > 0 && current.isModified;

    if (!shouldDelete && !shouldSave) return response;

    // Serialize the cookie before touching the store. A MAX_COOKIE_SIZE
    // overflow therefore answers with a normal JSON error instead of
    // persisting an orphan row and failing later in the post-handler save.
    if (shouldSave && typeof auth.buildCookieString === "function") {
      try {
        auth.buildCookieString(current);
      } catch (error) {
        console.error(
          "[session] Refusing to persist a session whose cookie cannot be serialized:",
          error,
        );
        return sendError(errorConfig);
      }
    }

    try {
      if (shouldDelete) {
        await auth.deleteSession(current, response.headers);
      } else {
        await auth.saveSession(current, response.headers);
      }
    } catch (error) {
      // A store may insert before serializing its own cookie. Only a brand-new
      // row can be an orphan, so remove it when persistence itself failed.
      if (shouldSave && !current.isFound) {
        try {
          await auth.deleteSession(current, new Headers());
        } catch {
          // Rollback is best effort; the original failure is reported below.
        }
      }

      console.error("[session] Failed to persist the request session:", error);
      return sendError(errorConfig);
    }

    return response;
  },
  {
    id: "session-manager",
    code: 500,
    message: "Internal Server Error",
  },
);

/**
 * Loads the request session into `ctx.session` and persists session changes
 * after downstream guards and handlers complete.
 *
 * Accepts a session service directly (the original form) or a mount object
 * with a readonly switch:
 *
 * ```ts
 * @use(session(sessions))                     // writable
 * @use(session({ auth: sessions, readonly: true })) // discard writes
 * @use(session<AccountSession>(sessions))     // typed ctx.session data
 * ```
 *
 * Type the handler context with {@link SessionContext} (or read the session
 * from the generic mount) to avoid casting `ctx.session` data properties.
 *
 * @param mount - Session service, or `{ auth, readonly? }`.
 * @param overrideConfig - Optional error configuration for persistence errors.
 * @returns A guard that loads, exposes, and persists the request session.
 */
export function session<TData extends Record<string, any> = Record<string, any>>(
  mount: SessionAuthInterface<any> | SessionMount<any>,
  overrideConfig: BaseConfig = {},
): SessionGuard<TData> {
  const normalized: NormalizedMount = isMount(mount)
    ? { auth: mount.auth, readonly: mount.readonly ?? false }
    : { auth: mount, readonly: false };

  return sessionGuard(normalized, overrideConfig);
}

/**
 * A `ctx` whose `session` is typed with the mounted session data.
 *
 * ```ts
 * import type { SessionContext } from "rossa";
 *
 * async post(ctx: SessionContext<AccountSession>) {
 *   ctx.session?.email; // string — no cast
 * }
 * ```
 */
export type SessionContext<
  TData extends Record<string, any> = Record<string, any>,
> = import("@/http/ctx").ctx<
  Record<string, string>,
  import("@/auth/session/server-side").SessionInstance<TData>
>;

/** Optional extra check applied to a session that `session()` already resolved. */
export type SessionValidator = (
  session: ServerSide,
) => boolean | Promise<boolean>;

/**
 * Rejects requests that do not carry a valid, stored session.
 *
 * A session counts as authenticated only when the cookie signature is valid,
 * the row still exists in the store, it has not expired, and it is not a
 * freshly created anonymous session. Compose this guard after
 * `session(service)` — it reads `ctx.session` and never loads the cookie
 * itself:
 *
 * ```ts
 * @use(session(service), requireSession())
 * ```
 *
 * Pass a validator to add an application-level check, for example an identity
 * field written during login. Session data keys are not part of the
 * `ServerSide` type, so cast to your session shape:
 *
 * ```ts
 * @use(session(service), requireSession((s) => typeof (s as AccountSession).userId === "number"))
 * ```
 *
 * @param validator - Optional additional check for the resolved session.
 * @returns A guard factory that returns 401 and continues otherwise.
 */
export const requireSession = createGuard<SessionValidator | undefined>(
  async (ctx, next, validator, errorConfig) => {
    const current = ctx.session;

    if (!current || !current.isFound || current.isNew) {
      return sendError(errorConfig);
    }

    if (validator && !(await validator(current))) {
      return sendError(errorConfig);
    }

    return await next();
  },
  { id: "require-session", code: 401, message: "Authentication required" },
);
