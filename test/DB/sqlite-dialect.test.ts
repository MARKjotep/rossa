import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SQL, sql } from "bun";
import type { SQL as SQLClient } from "bun";
import { t } from "../../src/db/column";
import { DbSchema } from "../../src/db/schema";
import { sqliteDialect } from "../../src/db/dialects/sqlite";

interface DialectRow {
  id: number;
  label: string;
}

const SIZE_UNITS = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

function parseDiskSize(value: string): number {
  const match = /^(\d+(?:\.\d+)?) (B|KB|MB|GB|TB)$/.exec(value);
  if (!match) throw new Error(`Unexpected disk size: ${value}`);
  return Number(match[1]) * SIZE_UNITS[match[2] as keyof typeof SIZE_UNITS];
}

describe("SQLite dialect adapter", () => {
  let db: SQLClient;
  let schema: DbSchema<DialectRow>;

  beforeEach(async () => {
    db = new SQL(":memory:", { max: 1 });
    schema = new DbSchema<DialectRow>(
      "dialect_checks",
      {
        id: t.serial().primary,
        label: t.text().notNull.unique,
      },
      sqliteDialect,
    );
    await sqliteDialect.createTable(db, schema);
  });

  afterEach(async () => {
    await db.close();
  });

  test("renders SQLite column definitions and normalizes ILIKE", () => {
    expect(
      sqliteDialect.buildColumn("active", t.boolean().notNull.default(true)),
    ).toBe('"active" INTEGER NOT NULL DEFAULT 1');
    expect(
      sqliteDialect.buildColumn("created_at", t.timestamp().defaultNow),
    ).toBe('"created_at" TEXT DEFAULT CURRENT_TIMESTAMP');
    expect(sqliteDialect.normalizeOperator("ILIKE")).toBe("LIKE");
  });

  test("renders column types with flags and escaped defaults", () => {
    expect(sqliteDialect.buildColumnType(t.int().notNull.default(5))).toBe(
      "INTEGER NOT NULL DEFAULT 5",
    );
    expect(sqliteDialect.buildColumnType(t.text().default("it's"))).toBe(
      "TEXT DEFAULT 'it''s'",
    );
  });

  test("reports SQLite version, tables, columns, indexes, and row statistics", async () => {
    await db`INSERT INTO "dialect_checks" (label) VALUES (${"Ada"})`;

    expect(await sqliteDialect.version(db)).toMatch(/^\d+\.\d+/);
    expect(await sqliteDialect.listTables(db)).toContain("dialect_checks");
    expect(await sqliteDialect.getColumns(db, schema)).toEqual(["id", "label"]);

    const stats = await sqliteDialect.getTableStats(db, schema);
    expect(stats.rowCount).toBe(1);
    expect(stats.indexCount).toBeGreaterThan(0);
    expect(stats.diskSize).toMatch(/^\d+(\.\d+)? (B|KB|MB|GB|TB)$|^0 B$/);
    expect(await sqliteDialect.getTableSchema(db, schema)).toHaveLength(2);
    expect(await sqliteDialect.getTableIndices(db, schema)).not.toHaveLength(0);
    const rows = await sqliteDialect.getTableData(db, schema, 10, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, label: "Ada" });
  });

  test("upserts update only non-conflict columns", async () => {
    const created = await sqliteDialect.upsert(
      db,
      schema,
      { id: 1, label: "Ada" } as DialectRow,
      "id",
    );
    expect(created).toMatchObject({ id: 1, label: "Ada" });

    const updated = await sqliteDialect.upsert(
      db,
      schema,
      { id: 1, label: "Grace" } as DialectRow,
      "id",
    );
    expect(updated).toMatchObject({ id: 1, label: "Grace" });

    const [count] = await db<{ total: number }[]>`
      SELECT COUNT(*) AS total FROM "dialect_checks"
    `;
    expect(Number(count?.total)).toBe(1);
  });

  test("upsert falls back to updating the conflict column when data has no other columns", async () => {
    interface OnlyRow {
      code: string;
      note?: string | null;
    }
    const onlySchema = new DbSchema<OnlyRow>(
      "upsert_only",
      {
        code: t.text().primary,
        note: t.text(),
      },
      sqliteDialect,
    );
    await sqliteDialect.createTable(db, onlySchema);
    await db`INSERT INTO "upsert_only" (code, note) VALUES (${"a"}, ${"first"})`;

    const updated = await sqliteDialect.upsert(
      db,
      onlySchema,
      { code: "a" },
      "code",
    );
    expect(updated).toMatchObject({ code: "a", note: "first" });
  });

  test("truncate resets an AUTOINCREMENT sequence", async () => {
    await db`${sql.unsafe(
      'CREATE TABLE "autoincrement_checks" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "label" TEXT NOT NULL)',
    )}`;
    const autoSchema = new DbSchema<{ id: number; label: string }>(
      "autoincrement_checks",
      { id: t.serial().primary, label: t.text().notNull },
      sqliteDialect,
    );
    await db`INSERT INTO "autoincrement_checks" (label) VALUES (${"a"})`;
    await db`INSERT INTO "autoincrement_checks" (label) VALUES (${"b"})`;

    await sqliteDialect.truncateTable(db, autoSchema);

    const [row] = await db<{ id: number }[]>`
      INSERT INTO "autoincrement_checks" (label) VALUES (${"c"}) RETURNING id
    `;
    expect(row?.id).toBe(1);
  });

  test("getTableData honors limit and offset", async () => {
    for (const label of ["a", "b", "c", "d", "e"]) {
      await db`INSERT INTO "dialect_checks" (label) VALUES (${label})`;
    }

    const page = await sqliteDialect.getTableData(db, schema, 2, 1);
    expect(page.map((row: DialectRow) => row.label)).toEqual(["b", "c"]);
  });

  test("schema-qualified table names work across inspection methods", async () => {
    const qualified = new DbSchema<DialectRow>(
      "main.dialect_checks",
      {
        id: t.serial().primary,
        label: t.text().notNull.unique,
      },
      sqliteDialect,
    );
    await db`INSERT INTO "dialect_checks" (label) VALUES (${"Qualified"})`;

    expect(await sqliteDialect.getColumns(db, qualified)).toEqual([
      "id",
      "label",
    ]);
    const stats = await sqliteDialect.getTableStats(db, qualified);
    expect(stats.rowCount).toBe(1);
    expect(stats.diskSize).toMatch(/^\d+(\.\d+)? (B|KB|MB|GB|TB)$|^0 B$/);
    expect(await sqliteDialect.getTableIndices(db, qualified)).not.toHaveLength(
      0,
    );
    expect(await sqliteDialect.getTableSchema(db, qualified)).toHaveLength(2);

    await db`INSERT INTO "dialect_checks" (label) VALUES (${"Second"})`;
    const page = await sqliteDialect.getTableData(db, qualified, 5, 1);
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({ label: "Second" });
  });

  test("disk size grows after inserts", async () => {
    const before = await sqliteDialect.getTableStats(db, schema);
    const payload = "x".repeat(180);
    for (let index = 0; index < 200; index += 1) {
      await db`INSERT INTO "dialect_checks" (label) VALUES (${`label-${index}-${payload}`})`;
    }
    const after = await sqliteDialect.getTableStats(db, schema);
    expect(parseDiskSize(after.diskSize)).toBeGreaterThan(
      parseDiskSize(before.diskSize),
    );
  });

  test("adds and drops plain columns, and rejects SQLite add-column constraints", async () => {
    await sqliteDialect.addColumn(db, schema, "nickname", "TEXT");
    expect(await sqliteDialect.getColumns(db, schema)).toContain("nickname");

    await sqliteDialect.dropColumn(db, schema, "nickname");
    expect(await sqliteDialect.getColumns(db, schema)).not.toContain(
      "nickname",
    );

    await expect(
      sqliteDialect.addColumn(db, schema, "new_id", "INTEGER PRIMARY KEY"),
    ).rejects.toThrow("SQLite cannot add PRIMARY KEY or UNIQUE constraints");
    await expect(
      sqliteDialect.addColumn(db, schema, "new_label", "TEXT UNIQUE"),
    ).rejects.toThrow("SQLite cannot add PRIMARY KEY or UNIQUE constraints");
  });

  test("truncates rows, optimizes the database, and drops the table", async () => {
    await db`INSERT INTO "dialect_checks" (label) VALUES (${"Ada"})`;
    await db`INSERT INTO "dialect_checks" (label) VALUES (${"Grace"})`;

    await sqliteDialect.truncateTable(db, schema);
    const [count] = await db<{ total: number }[]>`
      SELECT COUNT(*) AS total FROM "dialect_checks"
    `;
    expect(Number(count?.total)).toBe(0);

    await expect(sqliteDialect.optimize(db, schema)).resolves.toBeUndefined();
    await sqliteDialect.dropTable(db, schema);
    expect(await sqliteDialect.listTables(db)).not.toContain("dialect_checks");
  });

  test("quotes identifiers safely", () => {
    expect(sqliteDialect.quoteIdentifier('odd"name')).toBe('"odd""name"');
    expect(sqliteDialect.quoteTable("main.dialect_checks")).toBe(
      '"main"."dialect_checks"',
    );
    expect(() => sqliteDialect.quoteIdentifier("bad\0name")).toThrow(
      "cannot contain NUL",
    );
  });
});
