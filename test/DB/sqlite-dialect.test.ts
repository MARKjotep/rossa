import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import type { SQL as SQLClient } from "bun";
import { t } from "../../src/db/column";
import { Schema } from "../../src/db/schema";
import { sqliteDialect } from "../../src/db/dialects/sqlite";

interface DialectRow {
  id: number;
  label: string;
}

describe("SQLite dialect adapter", () => {
  let db: SQLClient;
  let schema: Schema<DialectRow>;

  beforeEach(async () => {
    db = new SQL(":memory:", { max: 1 });
    schema = new Schema<DialectRow>(
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

  test("reports SQLite version, tables, columns, indexes, and row statistics", async () => {
    await db`INSERT INTO "dialect_checks" (label) VALUES (${"Ada"})`;

    expect(await sqliteDialect.version(db)).toMatch(/^\d+\.\d+/);
    expect(await sqliteDialect.listTables(db)).toContain("dialect_checks");
    expect(await sqliteDialect.getColumns(db, schema)).toEqual(["id", "label"]);

    const stats = await sqliteDialect.getTableStats(db, schema);
    expect(stats.rowCount).toBe(1);
    expect(stats.indexCount).toBeGreaterThan(0);
    expect(stats.diskSize).toContain("SQLite file-level");
    expect(await sqliteDialect.getTableSchema(db, schema)).toHaveLength(2);
    expect(await sqliteDialect.getTableIndices(db, schema)).not.toHaveLength(0);
    const rows = await sqliteDialect.getTableData(db, schema, 10, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, label: "Ada" });
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
