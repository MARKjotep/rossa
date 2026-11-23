import { SQL, sql } from "bun";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Journal mode requested for a SQLite connection. In-memory databases stay in "memory" mode. */
export type SqliteJournalMode =
  | "WAL"
  | "DELETE"
  | "TRUNCATE"
  | "PERSIST"
  | "MEMORY"
  | "OFF";

/** Durability level for committed transactions. "NORMAL" is the usual companion to WAL. */
export type SqliteSynchronous = "FULL" | "NORMAL" | "OFF";

/** Where SQLite keeps temporary tables and sort spills. */
export type SqliteTempStore = "MEMORY" | "FILE" | "DEFAULT";

/** Setup options applied by `configureSqlite` / `createSqliteDatabase`. */
export interface SqliteConfigOptions {
  /** Journal mode to request. Default "WAL". In-memory databases always report "memory". */
  journalMode?: SqliteJournalMode;
  /** Durability level. Default "NORMAL" (safe with WAL; loses only the last commits on power loss). Use "FULL" for maximum durability. Never "OFF". */
  synchronous?: SqliteSynchronous;
  /** Milliseconds a connection waits on a locked database before failing. Default 5000. */
  busyTimeoutMs?: number;
  /** Enforce declared foreign keys. Default true. */
  foreignKeys?: boolean;
  /** Per-connection page cache. Negative = KiB budget (default -32000 ≈ 31.25 MiB), positive = pages. Nonzero integer. */
  cacheSizeKiB?: number;
  /** Optional temp store. Undefined = leave SQLite default (benchmark before enabling MEMORY). */
  tempStore?: SqliteTempStore;
}

/** Effective SQLite settings read back after configuration. */
export interface SqliteConnectionInfo {
  /** Effective journal mode as SQLite reports it (lowercase, e.g. "wal"). */
  journalMode: string;
  /** Effective `synchronous` value: 0 = OFF, 1 = NORMAL, 2 = FULL, 3 = EXTRA. */
  synchronous: number;
  /** Effective busy timeout in milliseconds. */
  busyTimeoutMs: number;
  /** Whether declared foreign keys are enforced. */
  foreignKeys: boolean;
  /** Configured page-cache setting (negative = KiB budget, positive = pages). */
  cacheSizeKiB: number;
  /** Database page size in bytes. */
  pageSize: number;
  /** Current number of database pages. */
  pageCount: number;
}

/** An open SQLite connection returned by `createSqliteDatabase`. */
export interface SqliteConnection {
  /** The Bun SQL client connected to this database. */
  db: SQL;
  /** Absolute database path, or ":memory:" for in-memory databases. */
  filename: string;
  /** Effective settings read back during setup. */
  info: SqliteConnectionInfo;
  /** Close the underlying connection. */
  close(): Promise<void>;
}

const JOURNAL_MODES: readonly SqliteJournalMode[] = [
  "WAL",
  "DELETE",
  "TRUNCATE",
  "PERSIST",
  "MEMORY",
  "OFF",
];
const SYNCHRONOUS_MODES: readonly SqliteSynchronous[] = ["FULL", "NORMAL", "OFF"];
const TEMP_STORES: readonly SqliteTempStore[] = ["MEMORY", "FILE", "DEFAULT"];

function assertOption<T extends string>(
  value: string,
  allowed: readonly T[],
  name: string,
): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new RangeError(
      `SQLite ${name} must be one of: ${allowed.join(", ")}.`,
    );
  }
}

function firstRow<T>(rows: T[], label: string): T {
  const [row] = rows;
  if (!row) {
    throw new Error(`SQLite did not return a row for ${label}.`);
  }
  return row;
}

/**
 * Apply SQLite PRAGMAs to an existing connection and report the effective
 * values. WAL, NORMAL durability, foreign keys, and a busy timeout make a
 * connection suitable for a typical local application database.
 */
export async function configureSqlite(
  db: SQL,
  options: SqliteConfigOptions = {},
): Promise<SqliteConnectionInfo> {
  const journalMode = options.journalMode ?? "WAL";
  const synchronous = options.synchronous ?? "NORMAL";
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
  const foreignKeys = options.foreignKeys ?? true;
  const cacheSizeKiB = options.cacheSizeKiB ?? -32000;
  const tempStore = options.tempStore;

  assertOption(journalMode, JOURNAL_MODES, "journalMode");
  assertOption(synchronous, SYNCHRONOUS_MODES, "synchronous");
  if (tempStore !== undefined) {
    assertOption(tempStore, TEMP_STORES, "tempStore");
  }
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError(
      "SQLite busyTimeoutMs must be a safe integer greater than or equal to 0.",
    );
  }
  if (!Number.isSafeInteger(cacheSizeKiB) || cacheSizeKiB === 0) {
    throw new RangeError(
      "SQLite cacheSizeKiB must be a nonzero safe integer.",
    );
  }

  // The values interpolated below are validated enums, booleans, or safe
  // integers, so they cannot carry arbitrary SQL.
  await db`${sql.unsafe(`PRAGMA journal_mode = ${journalMode}`)}`;
  await db`${sql.unsafe(`PRAGMA synchronous = ${synchronous}`)}`;
  await db`${sql.unsafe(`PRAGMA busy_timeout = ${busyTimeoutMs}`)}`;
  await db`${sql.unsafe(`PRAGMA foreign_keys = ${foreignKeys ? "ON" : "OFF"}`)}`;
  await db`${sql.unsafe(`PRAGMA cache_size = ${cacheSizeKiB}`)}`;
  if (tempStore !== undefined) {
    await db`${sql.unsafe(`PRAGMA temp_store = ${tempStore}`)}`;
  }

  const journal = firstRow(
    await db<{ journal_mode: string }[]>`${sql.unsafe("PRAGMA journal_mode")}`,
    "journal_mode",
  );
  const sync = firstRow(
    await db<{ synchronous: number }[]>`${sql.unsafe("PRAGMA synchronous")}`,
    "synchronous",
  );
  const busy = firstRow(
    await db<{ timeout: number }[]>`${sql.unsafe("PRAGMA busy_timeout")}`,
    "busy_timeout",
  );
  const fk = firstRow(
    await db<{ foreign_keys: number }[]>`${sql.unsafe("PRAGMA foreign_keys")}`,
    "foreign_keys",
  );
  const pageSize = firstRow(
    await db<{ page_size: number }[]>`${sql.unsafe("PRAGMA page_size")}`,
    "page_size",
  );
  const pageCount = firstRow(
    await db<{ page_count: number }[]>`${sql.unsafe("PRAGMA page_count")}`,
    "page_count",
  );

  return {
    journalMode: String(journal.journal_mode).toLowerCase(),
    synchronous: Number(sync.synchronous),
    busyTimeoutMs: Number(busy.timeout),
    foreignKeys: Number(fk.foreign_keys) === 1,
    cacheSizeKiB,
    pageSize: Number(pageSize.page_size),
    pageCount: Number(pageCount.page_count),
  };
}

/**
 * Open a SQLite database through Bun SQL, creating its parent directory, and
 * apply the recommended PRAGMAs. Pass ":memory:" for a throwaway database.
 */
export async function createSqliteDatabase(
  filename: string,
  options: SqliteConfigOptions = {},
): Promise<SqliteConnection> {
  if (!filename) {
    throw new RangeError("SQLite filename must be a non-empty string.");
  }

  if (filename === ":memory:") {
    const db = new SQL(":memory:");
    const info = await configureSqlite(db, options);
    return {
      db,
      filename,
      info,
      close: async () => {
        await db.close();
      },
    };
  }

  const absolute = resolve(filename);
  await mkdir(dirname(absolute), { recursive: true });
  const db = new SQL(`sqlite://${absolute}`);
  const info = await configureSqlite(db, options);
  return {
    db,
    filename: absolute,
    info,
    close: async () => {
      await db.close();
    },
  };
}

/**
 * Run SQLite's integrity check and report whether the database is healthy.
 * Corruption details are returned in `messages`.
 */
export async function sqliteIntegrityCheck(
  db: SQL,
): Promise<{ ok: boolean; messages: string[] }> {
  const rows = await db<{ integrity_check: string }[]>`
    ${sql.unsafe("PRAGMA integrity_check")}
  `;
  const messages = rows.map((row) => String(row.integrity_check));
  if (messages.length === 0) {
    return { ok: false, messages: ["integrity_check returned no rows"] };
  }
  return { ok: messages.length === 1 && messages[0] === "ok", messages };
}

/**
 * Checkpoint the write-ahead log, flushing WAL pages back into the main
 * database file. "PASSIVE" never blocks ongoing readers or writers.
 */
export async function sqliteWalCheckpoint(
  db: SQL,
  mode: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE" = "PASSIVE",
): Promise<{ busy: number; log: number; checkpointed: number }> {
  assertOption(mode, ["PASSIVE", "FULL", "RESTART", "TRUNCATE"] as const, "checkpoint mode");
  const [row] = await db<{ busy: number; log: number; checkpointed: number }[]>`
    ${sql.unsafe(`PRAGMA wal_checkpoint(${mode})`)}
  `;
  return {
    busy: Number(row?.busy ?? 0),
    log: Number(row?.log ?? 0),
    checkpointed: Number(row?.checkpointed ?? 0),
  };
}
