import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL, sql } from "bun";
import type { SQL as SQLClient } from "bun";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  configureSqlite,
  createSqliteDatabase,
  sqliteIntegrityCheck,
  sqliteWalCheckpoint,
  type SqliteJournalMode,
  type SqliteSynchronous,
  type SqliteTempStore,
} from "@/db";

describe("configureSqlite on an in-memory database", () => {
  test("applies the recommended defaults and reports effective values", async () => {
    const db = new SQL(":memory:", { max: 1 });
    try {
      const info = await configureSqlite(db);

      expect(info.journalMode).toBe("memory");
      expect(info.synchronous).toBe(1);
      expect(info.busyTimeoutMs).toBe(5000);
      expect(info.foreignKeys).toBe(true);
      expect(info.cacheSizeKiB).toBe(-32000);
      expect(info.pageSize).toBeGreaterThan(0);
      expect(info.pageCount).toBeGreaterThanOrEqual(0);
    } finally {
      await db.close();
    }
  });

  test("rejects invalid options with RangeError before touching the database", async () => {
    const db = new SQL(":memory:", { max: 1 });
    try {
      await expect(
        configureSqlite(db, { busyTimeoutMs: -1 }),
      ).rejects.toThrow(RangeError);
      await expect(
        configureSqlite(db, { busyTimeoutMs: 1.5 }),
      ).rejects.toThrow(RangeError);
      await expect(
        configureSqlite(db, { busyTimeoutMs: Number.MAX_SAFE_INTEGER + 1 }),
      ).rejects.toThrow(RangeError);
      await expect(
        configureSqlite(db, { cacheSizeKiB: 0 }),
      ).rejects.toThrow(RangeError);
      await expect(
        configureSqlite(db, { cacheSizeKiB: 1.25 }),
      ).rejects.toThrow(RangeError);
      await expect(
        configureSqlite(db, {
          journalMode: "VACUUM" as SqliteJournalMode,
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        configureSqlite(db, {
          synchronous: "EXTRA" as SqliteSynchronous,
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        configureSqlite(db, {
          tempStore: "DISK" as SqliteTempStore,
        }),
      ).rejects.toThrow(RangeError);
    } finally {
      await db.close();
    }
  });
});

describe("configureSqlite on a file database", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rossa-sqlite-config-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("enables WAL and creates -wal/-shm sidecar files after a write", async () => {
    const conn = await createSqliteDatabase(join(dir, "wal.db"));
    try {
      expect(conn.info.journalMode).toBe("wal");
      expect(conn.info.synchronous).toBe(1);
      expect(conn.info.foreignKeys).toBe(true);

      await conn.db`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`;
      await conn.db`INSERT INTO notes (body) VALUES (${"hello"})`;

      expect(existsSync(`${conn.filename}-wal`)).toBe(true);
      expect(existsSync(`${conn.filename}-shm`)).toBe(true);
      expect(statSync(`${conn.filename}-wal`).size).toBeGreaterThan(0);
    } finally {
      await conn.close();
    }
  });

  test("honors custom durability, timeout, foreign key, and journal options", async () => {
    const conn = await createSqliteDatabase(join(dir, "custom.db"), {
      journalMode: "DELETE",
      synchronous: "FULL",
      busyTimeoutMs: 2500,
      foreignKeys: false,
    });
    try {
      expect(conn.info.journalMode).toBe("delete");
      expect(conn.info.synchronous).toBe(2);
      expect(conn.info.busyTimeoutMs).toBe(2500);
      expect(conn.info.foreignKeys).toBe(false);
      expect(conn.info.cacheSizeKiB).toBe(-32000);

      await conn.db`CREATE TABLE "parents" ("id" INTEGER PRIMARY KEY)`;
      await conn.db`${sql.unsafe(
        'CREATE TABLE "children" ("id" INTEGER PRIMARY KEY, "parent_id" INTEGER REFERENCES "parents"("id"))',
      )}`;

      // Foreign keys are off, so an orphaned child is accepted.
      await conn.db`INSERT INTO "children" ("parent_id") VALUES (${999})`;
      const [row] = await conn.db<{ parent_id: number }[]>`
        SELECT "parent_id" FROM "children"
      `;
      expect(row?.parent_id).toBe(999);
    } finally {
      await conn.close();
    }
  });

  test("enforces declared foreign keys end-to-end with default options", async () => {
    const conn = await createSqliteDatabase(join(dir, "fk.db"));
    try {
      await conn.db`CREATE TABLE "parents" ("id" INTEGER PRIMARY KEY)`;
      await conn.db`${sql.unsafe(
        'CREATE TABLE "children" ("id" INTEGER PRIMARY KEY, "parent_id" INTEGER NOT NULL REFERENCES "parents"("id"))',
      )}`;

      await expect(
        conn.db`INSERT INTO "children" ("parent_id") VALUES (${42})`,
      ).rejects.toThrow(/FOREIGN KEY constraint failed/i);

      await conn.db`INSERT INTO "parents" ("id") VALUES (${1})`;
      await conn.db`INSERT INTO "children" ("parent_id") VALUES (${1})`;

      const [row] = await conn.db<{ total: number }[]>`
        SELECT COUNT(*) AS total FROM "children"
      `;
      expect(Number(row?.total)).toBe(1);
    } finally {
      await conn.close();
    }
  });
});

describe("createSqliteDatabase", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rossa-sqlite-files-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates nested directories, returns an absolute path, and preserves rows across reopens", async () => {
    const filename = join(dir, "sub", "dir", "app.db");
    const first = await createSqliteDatabase(filename);
    try {
      expect(first.filename).toBe(filename);
      expect(isAbsolute(first.filename)).toBe(true);
      expect(existsSync(join(dir, "sub", "dir"))).toBe(true);

      await first.db`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`;
      await first.db`INSERT INTO notes (body) VALUES (${"kept"})`;
    } finally {
      await first.close();
    }

    const second = await createSqliteDatabase(filename);
    try {
      const [row] = await second.db<{ total: number }[]>`
        SELECT COUNT(*) AS total FROM notes
      `;
      expect(Number(row?.total)).toBe(1);

      await second.db`INSERT INTO notes (body) VALUES (${"also kept"})`;
    } finally {
      await second.close();
    }

    const third = await createSqliteDatabase(filename);
    try {
      const [row] = await third.db<{ total: number }[]>`
        SELECT COUNT(*) AS total FROM notes
      `;
      // Reopening must not recreate or wipe the existing table.
      expect(Number(row?.total)).toBe(2);
    } finally {
      await third.close();
    }
  });

  test("supports ':memory:' databases", async () => {
    const conn = await createSqliteDatabase(":memory:");
    try {
      expect(conn.filename).toBe(":memory:");
      expect(conn.info.journalMode).toBe("memory");

      await conn.db`CREATE TABLE scratch (id INTEGER PRIMARY KEY, value TEXT)`;
      for (let index = 0; index < 5; index += 1) {
        await conn.db`INSERT INTO scratch (value) VALUES (${`value-${index}`})`;
      }

      const [row] = await conn.db<{ total: number }[]>`
        SELECT COUNT(*) AS total FROM scratch
      `;
      expect(Number(row?.total)).toBe(5);
    } finally {
      await conn.close();
    }
  });
});

describe("sqliteIntegrityCheck", () => {
  let db: SQLClient;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    await db`CREATE TABLE healthy (id INTEGER PRIMARY KEY, body TEXT)`;
    await db`INSERT INTO healthy (body) VALUES (${"row"})`;
  });

  afterAll(async () => {
    await db.close();
  });

  test("reports a healthy database", async () => {
    const result = await sqliteIntegrityCheck(db);

    expect(result.ok).toBe(true);
    expect(result.messages).toEqual(["ok"]);
  });
});

describe("sqliteWalCheckpoint", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rossa-sqlite-checkpoint-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("checkpoints a WAL file and truncates it to zero bytes", async () => {
    const conn = await createSqliteDatabase(join(dir, "events.db"));
    try {
      await conn.db`CREATE TABLE events (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`;
      for (let index = 0; index < 20; index += 1) {
        await conn.db`INSERT INTO events (body) VALUES (${"x".repeat(40)})`;
      }

      const walPath = `${conn.filename}-wal`;
      expect(existsSync(walPath)).toBe(true);
      expect(statSync(walPath).size).toBeGreaterThan(0);

      const checkpoint = await sqliteWalCheckpoint(conn.db, "TRUNCATE");
      expect(Number.isInteger(checkpoint.busy)).toBe(true);
      expect(Number.isInteger(checkpoint.log)).toBe(true);
      expect(Number.isInteger(checkpoint.checkpointed)).toBe(true);
      expect(checkpoint.busy).toBeGreaterThanOrEqual(0);
      expect(checkpoint.log).toBeGreaterThanOrEqual(0);

      expect(statSync(walPath).size).toBe(0);

      await expect(
        sqliteWalCheckpoint(conn.db, "BOGUS" as "PASSIVE"),
      ).rejects.toThrow(RangeError);
    } finally {
      await conn.close();
    }
  });
});
