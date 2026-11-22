import type { SessionAuthInterface } from "@/auth/session/auth-interface";
import type { ServerSide } from "@/auth/session/server-side";
import { sendError } from "@/http/res";
import { createGuard } from "./@/base.guard";

export interface SessionConfig {
  auth: SessionAuthInterface;
  readonly?: boolean;
}

/**
 * Loads the request session into `ctx.session` and persists session changes
 * after downstream guards and handlers complete.
 *
 * @param auth - Session service used to load, save, and delete sessions.
 * @returns A guard factory that accepts a session service and optional error config.
 */
export const session = createGuard<SessionAuthInterface>(
  async (ctx, next, auth, errorConfig) => {
    // The framework uses the blueprint to parse the request...
    const [_sid, _session] = await auth.loadHeader(ctx.req.request);

    ctx.session = _session;

    const response = await next();

    if (!ctx.session.isReadOnly) {
      if (!ctx.session.length) {
        if (ctx.session.isNew) {
          if (_sid) {
            await auth.deleteSession(ctx.session, response.headers);
          }
        } else {
          if (ctx.session.isModified) {
            await auth.deleteSession(ctx.session, response.headers);
          }
        }
      } else if (ctx.session.isModified) {
        await auth.saveSession(ctx.session, response.headers);
      }
    }

    return response;
  },
  { id: "session-manager" },
);

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
