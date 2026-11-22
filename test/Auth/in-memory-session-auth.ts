import {
  SessionAuthInterface,
  type AuthConfig,
} from "../../src/auth/session/auth-interface";
import { ServerSide } from "../../src/auth/session/server-side";

export interface MemorySessionRow {
  id: string;
  data: Record<string, any>;
  expiration: string;
}

/**
 * In-memory session service for regression tests.
 *
 * `saveSession` deliberately persists before serializing the cookie (the
 * order documented for real stores). The guard's pre-serialization is what
 * prevents `MAX_COOKIE_SIZE` overflows from leaving an orphan row.
 */
export class MemorySessionAuth extends SessionAuthInterface {
  public readonly rows = new Map<string, MemorySessionRow>();
  public saveCalls = 0;

  constructor(config: AuthConfig = {}, salt = "session-test-salt") {
    super(config, salt);
  }

  public async fetchData(id: string): Promise<MemorySessionRow | undefined> {
    return this.rows.get(id);
  }

  public async saveSession(
    session: ServerSide,
    headers: Headers,
  ): Promise<void> {
    this.saveCalls += 1;
    this.rows.set(session.sid, {
      id: session.sid,
      data: { ...session.data },
      expiration: this.getSessionExpirationDate.toISOString(),
    });

    this.setCookie(session, headers);
  }

  public async deleteSession(
    session: ServerSide,
    headers: Headers,
  ): Promise<void> {
    if (session.isFound) {
      this.rows.delete(session.sid);
    }

    this.removeCookie(session, headers);
  }
}
