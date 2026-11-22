import { DbRepository, type DbSchema } from "@/db";
import {
  SessionAuthInterface,
  type AuthConfig,
} from "../../src/auth/session/auth-interface";
import type { SQL } from "bun";
import type { ServerSide } from "../../src/auth/session/server-side";

export interface session_db {
  id: string;
  data: Record<string, any>;
  expiration: string;
}

export class SessionAuthService<
  T extends session_db,
> extends SessionAuthInterface {
  private _db: DbRepository<session_db>;
  constructor(sql: SQL, schema: DbSchema<T>, config: AuthConfig, salt: string) {
    super(config, salt);
    this._db = new DbRepository<session_db>(sql, schema as DbSchema<session_db>);
  }

  public async init(): Promise<void> {
    await this._db.create();
    await this._db.syncColumns();
  }

  public async fetchData(id: string) {
    return await this._db.find({ id });
  }

  public async deleteSession(
    session: ServerSide,
    headers: Headers,
  ): Promise<void> {
    if (session.isFound) {
      await this._db.delete({ id: session.sid });
    }
    this.removeCookie(session, headers);
  }
  /**
   * Called automatically by the @session decorator IF the session was modified.
   */
  public async saveSession(
    session: ServerSide,
    headers: Headers,
  ): Promise<void> {
    await this._db.upsert(
      {
        id: session.sid,
        data: session.data,
        expiration: this.getSessionExpirationDate.toISOString(),
      },
      "id",
    );

    // log.i = `session id ${session.sid} saved.`;

    this.setCookie(session, headers);
  }
}
