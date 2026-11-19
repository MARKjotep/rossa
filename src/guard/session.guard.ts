import type { SessionAuthInterface } from "@/auth/session/auth-interface";
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
