import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL, sql } from "bun";
import type { SQL as SQLClient } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DatabaseError,
  DbRepository,
  DbSchema,
  ForeignKeyError,
  UniqueConstraintError,
  configureSqlite,
  createSqliteDatabase,
  sqliteDialect,
  t,
  type SqliteConnection,
  type Where,
  type Column,
} from "@/db";

interface WidgetRow {
  id: number;
  name: string;
  active: boolean;
  meta: string;
  price: number;
  created_at: string;
}

/** Widget inserts are intentionally partial: the database supplies defaults. */
const asWidget = (row: Partial<WidgetRow>): WidgetRow => row as WidgetRow;

function widgetSchema(table = "widgets"): DbSchema<WidgetRow> {
  const definitions: Record<keyof WidgetRow, Column> = {
    id: t.serial().primary,
    name: t.text().notNull.unique,
    active: t.boolean().notNull.default(false),
    meta: t.json(),
    price: t.numeric(10, 2).default(0),
    created_at: t.timestamp().defaultNow,
  };
  return new DbSchema<WidgetRow>(table, definitions, sqliteDialect);
}

function widgetRepo(
  db: SQLClient,
  table = "widgets",
): DbRepository<WidgetRow> {
  return new DbRepository(db, widgetSchema(table));
}

const SEEDS: ReadonlyArray<Record<string, unknown>> = [
  { name: "Alpha", active: true, meta: "m1", price: 10 },
  { name: "Beta", active: false, meta: null, price: 20 },
  { name: "Gamma", active: true, meta: "m3", price: 30 },
  { name: "Delta", active: false, meta: null, price: 40 },
  { name: "Epsilon", active: true, meta: "m5", price: 50 },
];

async function seedWidgets(repo: DbRepository<WidgetRow>): Promise<void> {
  for (const seed of SEEDS) {
    await repo.insert(seed as unknown as WidgetRow);
  }
}

/** Shorthand null conditions are not representable through `Where<T>` typing. */
const nullWhere = (where: Record<string, unknown>): Where<WidgetRow> =>
  where as unknown as Where<WidgetRow>;

describe("SQLite column types and defaults", () => {
  let db: SQLClient;
  let widgets: DbRepository<WidgetRow>;
  let bare: DbRepository<{ id: number }>;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    widgets = widgetRepo(db);
    bare = new DbRepository(
      db,
      new DbSchema<{ id: number }>(
        "bare_widgets",
        { id: t.serial().primary },
        sqliteDialect,
      ),
    );
    await widgets.create();
    await bare.create();
  });

  beforeEach(async () => {
    await widgets.inspect.truncateTable();
    await bare.inspect.truncateTable();
  });

  afterAll(async () => {
    await db.close();
  });

  test("round-trips text, boolean, json, numeric, and timestamp values", async () => {
    const row = await widgets.insert(
      asWidget({
        name: "Alpha",
        active: true,
        meta: JSON.stringify({ tier: 2 }),
        price: 19.99,
      }),
    );

    expect(row).toBeDefined();
    expect(row!.id).toBe(1);
    expect(row!.name).toBe("Alpha");
    // SQLite stores booleans as integers and reads them back as numbers.
    expect(typeof row!.active).toBe("number");
    expect(Number(row!.active)).toBe(1);
    expect(row!.meta).toBe('{"tier":2}');
    expect(row!.price).toBe(19.99);
    expect(row!.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const stored = await widgets.find({ name: "Alpha" });
    expect(stored).toMatchObject({ id: 1, name: "Alpha", meta: '{"tier":2}' });
    expect(stored!.created_at).toBe(row!.created_at);

    const falsy = await widgets.insert(
      asWidget({
        name: "Beta",
        active: false,
        meta: "{}",
        price: 0.5,
      }),
    );
    expect(Number(falsy!.active)).toBe(0);
    expect(falsy!.price).toBe(0.5);
  });

  test("applies column defaults for omitted values", async () => {
    const row = await widgets.insert(asWidget({ name: "Defaults" }));

    expect(row!.id).toBe(1);
    expect(Number(row!.active)).toBe(0);
    expect(row!.meta).toBeNull();
    expect(row!.price).toBe(0);
    expect(row!.created_at).not.toBe("");
    expect(row!.created_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test("inserts DEFAULT VALUES into a serial-only table and assigns ids", async () => {
    const first = await bare.insert({} as { id: number });
    const second = await bare.insert({} as { id: number });

    expect(first?.id).toBe(1);
    expect(second?.id).toBe(2);
    expect(await bare.count()).toBe(2);
  });
});

describe("SQLite query operators", () => {
  let db: SQLClient;
  let widgets: DbRepository<WidgetRow>;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    widgets = widgetRepo(db);
    await widgets.create();
  });

  beforeEach(async () => {
    await widgets.inspect.truncateTable();
    await seedWidgets(widgets);
  });

  afterAll(async () => {
    await db.close();
  });

  const names = async (where?: Where<WidgetRow>): Promise<string[]> =>
    (await widgets.findAll(where)).map((row) => row.name).sort();

  test("supports comparison operators", async () => {
    expect(await names({ price: { operator: "=", value: 20 } })).toEqual([
      "Beta",
    ]);
    expect(await names({ price: { operator: "!=", value: 20 } })).toEqual([
      "Alpha",
      "Delta",
      "Epsilon",
      "Gamma",
    ]);
    expect(await names({ price: { operator: "<", value: 20 } })).toEqual([
      "Alpha",
    ]);
    expect(await names({ price: { operator: "<=", value: 20 } })).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(await names({ price: { operator: ">", value: 40 } })).toEqual([
      "Epsilon",
    ]);
    expect(await names({ price: { operator: ">=", value: 40 } })).toEqual([
      "Delta",
      "Epsilon",
    ]);
  });

  test("supports LIKE patterns and normalizes ILIKE to case-insensitive LIKE", async () => {
    expect(await names({ name: { operator: "LIKE", value: "Al%" } })).toEqual([
      "Alpha",
    ]);
    expect(
      await names({ name: { operator: "ILIKE", value: "%aLpHa%" } }),
    ).toEqual(["Alpha"]);
    expect(await names({ name: { operator: "ILIKE", value: "%a%" } })).toEqual([
      "Alpha",
      "Beta",
      "Delta",
      "Gamma",
    ]);
  });

  test("supports IN and NOT IN including empty arrays", async () => {
    expect(
      await names({ price: { operator: "IN", value: [10, 30] } }),
    ).toEqual(["Alpha", "Gamma"]);
    expect(await names({ price: { operator: "IN", value: [] } })).toEqual([]);
    expect(
      await names({ price: { operator: "NOT IN", value: [10, 30] } }),
    ).toEqual(["Beta", "Delta", "Epsilon"]);
    expect(await names({ price: { operator: "NOT IN", value: [] } })).toEqual([
      "Alpha",
      "Beta",
      "Delta",
      "Epsilon",
      "Gamma",
    ]);
  });

  test("maps null checks to IS NULL and IS NOT NULL", async () => {
    expect(await names({ meta: { operator: "IS", value: null } })).toEqual([
      "Beta",
      "Delta",
    ]);
    expect(await names(nullWhere({ meta: null }))).toEqual(["Beta", "Delta"]);
    expect(await names({ meta: { operator: "!=", value: null } })).toEqual([
      "Alpha",
      "Epsilon",
      "Gamma",
    ]);
    expect(await names({ meta: { operator: "IS NOT", value: null } })).toEqual([
      "Alpha",
      "Epsilon",
      "Gamma",
    ]);
  });

  test("rejects unsupported operators before running SQL", async () => {
    for (const operator of ["; DROP TABLE widgets", "OR"]) {
      await expect(
        widgets.findAll({ name: { operator, value: "Alpha" } }),
      ).rejects.toThrow(TypeError);
    }

    // The table is still intact after the rejected operators.
    expect(await widgets.count()).toBe(5);
  });
});

describe("SQLite find, count, exists, and pagination", () => {
  let db: SQLClient;
  let widgets: DbRepository<WidgetRow>;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    widgets = widgetRepo(db);
    await widgets.create();
  });

  beforeEach(async () => {
    await widgets.inspect.truncateTable();
    await seedWidgets(widgets);
  });

  afterAll(async () => {
    await db.close();
  });

  test("finds single rows, lists rows, counts, and checks existence", async () => {
    expect(await widgets.findAll()).toHaveLength(5);
    expect(
      (await widgets.findAll({ active: true })).map((row) => row.name).sort(),
    ).toEqual(["Alpha", "Epsilon", "Gamma"]);

    const found = await widgets.find({ name: "Gamma" });
    expect(found).toMatchObject({ name: "Gamma", price: 30 });
    expect(await widgets.find({ name: "Missing" })).toBeNull();

    expect(await widgets.count()).toBe(5);
    expect(
      await widgets.count({ price: { operator: ">=", value: 40 } }),
    ).toBe(2);

    expect(await widgets.exists({ name: "Alpha" })).toBe(true);
    expect(await widgets.exists({ name: "Missing" })).toBe(false);
    expect(
      await widgets.exists({ meta: { operator: "IS", value: null } }),
    ).toBe(true);
  });

  test("paginates ordered results and filtered pages", async () => {
    const firstPage = await widgets.paginate(1, 2);
    expect(firstPage.map((row) => row.name)).toEqual(["Alpha", "Beta"]);

    const secondPage = await widgets.paginate(2, 2);
    expect(secondPage.map((row) => row.name)).toEqual(["Gamma", "Delta"]);

    const lastPage = await widgets.paginate(3, 2);
    expect(lastPage.map((row) => row.name)).toEqual(["Epsilon"]);

    const filteredFirst = await widgets.paginate(1, 2, { active: true });
    expect(filteredFirst.map((row) => row.name)).toEqual(["Alpha", "Gamma"]);
    const filteredSecond = await widgets.paginate(2, 2, { active: true });
    expect(filteredSecond.map((row) => row.name)).toEqual(["Epsilon"]);
  });

  test("rejects invalid pagination arguments", async () => {
    const invalid: Array<[number, number]> = [
      [0, 10],
      [-1, 10],
      [1.5, 10],
      [1, 0],
      [1, -5],
      [1, 2.5],
      [Number.MAX_SAFE_INTEGER, 2],
    ];

    for (const [page, limit] of invalid) {
      await expect(widgets.paginate(page, limit)).rejects.toThrow(RangeError);
    }
  });
});

describe("SQLite update and delete semantics", () => {
  let db: SQLClient;
  let widgets: DbRepository<WidgetRow>;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    widgets = widgetRepo(db);
    await widgets.create();
  });

  beforeEach(async () => {
    await widgets.inspect.truncateTable();
    await seedWidgets(widgets);
  });

  afterAll(async () => {
    await db.close();
  });

  test("updates matching rows and returns them", async () => {
    const updated = await widgets.update(
      { name: "Beta" },
      { price: 99, active: true },
    );

    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ name: "Beta", price: 99 });
    expect(Number(updated[0]?.active)).toBe(1);
    expect((await widgets.find({ name: "Beta" }))?.price).toBe(99);

    const typedWhere = await widgets.update({ id: 1 }, { name: "Alpha II" });
    expect(typedWhere.map((row) => row.name)).toEqual(["Alpha II"]);

    expect(await widgets.update({ name: "Nobody" }, { price: 1 })).toEqual([]);
  });

  test("deletes matching rows and returns them", async () => {
    const deleted = await widgets.delete({ name: "Alpha" });

    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.name).toBe("Alpha");
    expect(await widgets.find({ name: "Alpha" })).toBeNull();
    expect(await widgets.count()).toBe(4);
    expect(await widgets.delete({ name: "Nobody" })).toEqual([]);
  });

  test("refuses empty WHERE and empty UPDATE payloads", async () => {
    await expect(widgets.update({}, { price: 1 })).rejects.toThrow(
      DatabaseError,
    );
    await expect(widgets.delete({})).rejects.toThrow(DatabaseError);
    await expect(widgets.update({ name: "Alpha" }, {})).rejects.toThrow(
      DatabaseError,
    );
    await expect(widgets.delete({})).rejects.toThrow("WHERE condition");
    // Nothing was modified by the rejected calls.
    expect(await widgets.count()).toBe(5);
  });
});

describe("SQLite upsert", () => {
  let db: SQLClient;
  let widgets: DbRepository<WidgetRow>;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    widgets = widgetRepo(db);
    await widgets.create();
  });

  beforeEach(async () => {
    await widgets.inspect.truncateTable();
  });

  afterAll(async () => {
    await db.close();
  });

  test("inserts when the conflict target is absent", async () => {
    const created = await widgets.upsert(
      asWidget({ name: "Alpha", price: 5, meta: "{}" }),
      "name",
    );

    expect(created).toBeDefined();
    expect(created!.id).toBe(1);
    expect(created!.name).toBe("Alpha");
    expect(created!.price).toBe(5);
    expect(await widgets.count()).toBe(1);
  });

  test("updates only non-conflict columns when the unique column collides", async () => {
    const created = await widgets.upsert(
      asWidget({ name: "Alpha", price: 5, meta: "{}" }),
      "name",
    );
    const createdId = created!.id;
    const createdAt = created!.created_at;

    const updated = await widgets.upsert(
      asWidget({ name: "Alpha", price: 7, meta: '{"v":2}' }),
      "name",
    );

    expect(updated!.id).toBe(createdId);
    expect(updated!.name).toBe("Alpha");
    expect(updated!.price).toBe(7);
    expect(updated!.meta).toBe('{"v":2}');
    expect(updated!.created_at).toBe(createdAt);
    expect(await widgets.count()).toBe(1);

    const stored = await widgets.find({ name: "Alpha" });
    expect(stored).toMatchObject({ id: createdId, name: "Alpha", price: 7 });
  });
});

describe("SQLite transactions", () => {
  let db: SQLClient;
  let widgets: DbRepository<WidgetRow>;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    widgets = widgetRepo(db);
    await widgets.create();
  });

  beforeEach(async () => {
    await widgets.inspect.truncateTable();
  });

  afterAll(async () => {
    await db.close();
  });

  test("commits a successful transaction callback", async () => {
    const countInside = await widgets.transaction(async (tx) => {
      await tx.insert(asWidget({ name: "Committed", price: 1 }));
      return tx.count();
    });

    expect(countInside).toBe(1);
    expect(await widgets.count()).toBe(1);
    expect(await widgets.exists({ name: "Committed" })).toBe(true);
  });

  test("rolls back all writes when the callback throws and propagates the error", async () => {
    await expect(
      widgets.transaction(async (tx) => {
        await tx.insert(asWidget({ name: "First" }));
        await tx.insert(asWidget({ name: "Second" }));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await widgets.count()).toBe(0);
  });

  test("writes through withContext inside an external transaction", async () => {
    const seenInside = await db.begin(async (tx) => {
      const scoped = widgets.withContext(tx);
      await scoped.insert(asWidget({ name: "Scoped", price: 3 }));
      return scoped.count();
    });

    expect(seenInside).toBe(1);
    expect(await widgets.count()).toBe(1);
    expect((await widgets.find({ name: "Scoped" }))?.price).toBe(3);
  });

  test("leaves the table unchanged when an external transaction rolls back", async () => {
    let countInside = 0;

    await expect(
      db.begin(async (tx) => {
        const scoped = widgets.withContext(tx);
        await scoped.insert(asWidget({ name: "Rollback" }));
        countInside = await scoped.count();
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(countInside).toBe(1);
    expect(await widgets.count()).toBe(0);
  });
});

describe("SQLite unique constraint error mapping", () => {
  let db: SQLClient;
  let widgets: DbRepository<WidgetRow>;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    widgets = widgetRepo(db);
    await widgets.create();
  });

  beforeEach(async () => {
    await widgets.inspect.truncateTable();
  });

  afterAll(async () => {
    await db.close();
  });

  test("maps duplicate unique inserts to UniqueConstraintError", async () => {
    await widgets.insert(asWidget({ name: "Alpha" }));

    let error: unknown;
    try {
      await widgets.insert(asWidget({ name: "Alpha" }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(UniqueConstraintError);
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as Error).message).toMatch(/unique/i);
    expect(await widgets.count()).toBe(1);
  });
});

describe("SQLite foreign key error mapping", () => {
  interface TeamRow {
    id: number;
    name: string;
  }
  interface PlayerRow {
    id: number;
    team_id: number;
    name: string;
  }

  let db: SQLClient;
  let teams: DbRepository<TeamRow>;
  let players: DbRepository<PlayerRow>;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    // In-memory connections default to foreign_keys = OFF; enable them.
    await configureSqlite(db);
    teams = new DbRepository(
      db,
      new DbSchema<TeamRow>(
        "teams",
        { id: t.serial().primary, name: t.text().notNull },
        sqliteDialect,
      ),
    );
    players = new DbRepository(
      db,
      new DbSchema<PlayerRow>(
        "players",
        {
          id: t.serial().primary,
          team_id: t.int().notNull,
          name: t.text().notNull,
        },
        sqliteDialect,
      ),
    );
    await teams.create();
    await db`${sql.unsafe(
      'CREATE TABLE "players" ("id" INTEGER PRIMARY KEY, "team_id" INTEGER NOT NULL REFERENCES "teams"("id"), "name" TEXT NOT NULL)',
    )}`;
  });

  beforeEach(async () => {
    await players.inspect.truncateTable();
    await teams.inspect.truncateTable();
  });

  afterAll(async () => {
    await db.close();
  });

  test("rejects orphaned child inserts with ForeignKeyError", async () => {
    let error: unknown;
    try {
      await players.insert({ team_id: 99, name: "orphan" } as PlayerRow);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ForeignKeyError);
    expect(error).toBeInstanceOf(DatabaseError);
    expect(await players.count()).toBe(0);
  });

  test("accepts children of existing parents and rejects deleting a referenced parent", async () => {
    const team = await teams.insert({ name: "Red" } as TeamRow);
    await players.insert({ team_id: team!.id, name: "ada" } as PlayerRow);
    expect(await players.count()).toBe(1);

    let error: unknown;
    try {
      await teams.delete({ id: team!.id });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ForeignKeyError);
    expect(error).toBeInstanceOf(DatabaseError);
    expect(await teams.count()).toBe(1);
    expect(await players.count()).toBe(1);
  });
});

describe("SQLite syncColumns", () => {
  let db: SQLClient;

  beforeEach(() => {
    db = new SQL(":memory:", { max: 1 });
  });

  afterEach(async () => {
    await db.close();
  });

  test("adds missing columns while preserving existing rows", async () => {
    const base = new DbRepository(
      db,
      new DbSchema<{ id: number; name: string }>(
        "sync_add",
        { id: t.serial().primary, name: t.text().notNull },
        sqliteDialect,
      ),
    );
    await base.create();
    await base.insert({ name: "kept" } as { id: number; name: string });

    const expanded = new DbRepository(
      db,
      new DbSchema<{ id: number; name: string; nickname: string }>(
        "sync_add",
        {
          id: t.serial().primary,
          name: t.text().notNull,
          nickname: t.text(),
        },
        sqliteDialect,
      ),
    );
    await expanded.syncColumns();

    const columns = (await expanded.inspect.getTableSchema()).map(
      (column: { name: string }) => column.name,
    );
    expect(columns).toEqual(["id", "name", "nickname"]);

    const rows = await expanded.findAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("kept");
    expect(rows[0]?.nickname).toBeNull();
  });

  test("drops columns absent from the desired schema when allowDrop is true", async () => {
    const withLegacy = new DbRepository(
      db,
      new DbSchema<{ id: number; name: string; legacy: string }>(
        "sync_drop",
        {
          id: t.serial().primary,
          name: t.text().notNull,
          legacy: t.text(),
        },
        sqliteDialect,
      ),
    );
    await withLegacy.create();
    await withLegacy.insert({
      name: "kept",
      legacy: "old",
    } as { id: number; name: string; legacy: string });

    const desired = new DbRepository(
      db,
      new DbSchema<{ id: number; name: string }>(
        "sync_drop",
        { id: t.serial().primary, name: t.text().notNull },
        sqliteDialect,
      ),
    );
    await desired.syncColumns(true);

    const columns = (await desired.inspect.getTableSchema()).map(
      (column: { name: string }) => column.name,
    );
    expect(columns).toEqual(["id", "name"]);

    const rows = await desired.findAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("kept");
  });

  test("rejects adding PRIMARY KEY or UNIQUE columns through ALTER TABLE", async () => {
    const base = new DbRepository(
      db,
      new DbSchema<{ id: number; name: string }>(
        "sync_constraints",
        { id: t.serial().primary, name: t.text().notNull },
        sqliteDialect,
      ),
    );
    await base.create();

    const primaryAttempt = new DbRepository(
      db,
      new DbSchema<{ id: number; name: string; code: string }>(
        "sync_constraints",
        {
          id: t.serial().primary,
          name: t.text().notNull,
          code: t.text().primary,
        },
        sqliteDialect,
      ),
    );
    await expect(primaryAttempt.syncColumns()).rejects.toThrow(
      "SQLite cannot add PRIMARY KEY or UNIQUE constraints",
    );

    const uniqueAttempt = new DbRepository(
      db,
      new DbSchema<{ id: number; name: string; email: string }>(
        "sync_constraints",
        {
          id: t.serial().primary,
          name: t.text().notNull,
          email: t.text().unique,
        },
        sqliteDialect,
      ),
    );
    await expect(uniqueAttempt.syncColumns()).rejects.toThrow(
      "SQLite cannot add PRIMARY KEY or UNIQUE constraints",
    );

    const columns = (await base.inspect.getTableSchema()).map(
      (column: { name: string }) => column.name,
    );
    expect(columns).toEqual(["id", "name"]);
  });
});

describe("SQLite inspector", () => {
  let db: SQLClient;
  let widgets: DbRepository<WidgetRow>;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    widgets = widgetRepo(db);
    await widgets.create();
  });

  beforeEach(async () => {
    await widgets.inspect.truncateTable();
    await seedWidgets(widgets);
  });

  afterAll(async () => {
    await db.close();
  });

  test("lists and drops tables", async () => {
    const scratch = new DbRepository(
      db,
      new DbSchema<{ id: number; value: string }>(
        "scratch_table",
        { id: t.serial().primary, value: t.text() },
        sqliteDialect,
      ),
    );
    await scratch.create();
    expect(await scratch.inspect.listTables()).toContain("scratch_table");

    await scratch.inspect.dropTable();
    expect(await widgets.inspect.listTables()).not.toContain("scratch_table");
  });

  test("truncates rows and restarts serial ids", async () => {
    await widgets.inspect.truncateTable();
    expect(await widgets.count()).toBe(0);

    const row = await widgets.insert(asWidget({ name: "Fresh" }));
    expect(row?.id).toBe(1);
    expect(await widgets.count()).toBe(1);
  });

  test("reports row counts, disk size, and index counts", async () => {
    const stats = await widgets.inspect.getTableStats();

    expect(stats.rowCount).toBe(5);
    expect(stats.diskSize).toMatch(/^\d+\.\d{2} (B|KB|MB|GB|TB)$/);
    expect(stats.indexCount).toBeGreaterThanOrEqual(0);
  });

  test("reports column definitions and indices", async () => {
    const schema = await widgets.inspect.getTableSchema();
    expect(schema.map((column: { name: string }) => column.name)).toEqual([
      "id",
      "name",
      "active",
      "meta",
      "price",
      "created_at",
    ]);

    const indices = await widgets.inspect.getTableIndices();
    expect(indices.length).toBeGreaterThan(0);
    expect(
      indices.every((index: { name?: unknown }) => typeof index.name === "string"),
    ).toBe(true);
  });

  test("paginates raw table data and validates limit/offset", async () => {
    expect(await widgets.inspect.getTableData()).toHaveLength(5);

    const page = await widgets.inspect.getTableData(2, 1);
    expect(page.map((row: { name: string }) => row.name)).toEqual([
      "Beta",
      "Gamma",
    ]);

    expect(() => widgets.inspect.getTableData(-1, 0)).toThrow(RangeError);
    expect(() => widgets.inspect.getTableData(1, -1)).toThrow(RangeError);
    expect(() => widgets.inspect.getTableData(1.5, 0)).toThrow(RangeError);
    expect(() => widgets.inspect.getTableData(1, 0.5)).toThrow(RangeError);
  });

  test("optimizes the database", async () => {
    await expect(widgets.inspect.optimize()).resolves.toBeUndefined();
  });
});

describe("SQLite concurrent readers during a write (WAL)", () => {
  interface ItemRow {
    id: number;
    name: string;
  }

  let dir: string;
  let conn: SqliteConnection;
  let reader: SQLClient;
  let items: DbRepository<ItemRow>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "rossa-sqlite-wal-"));
    conn = await createSqliteDatabase(join(dir, "nested", "items.db"));
    items = new DbRepository(
      conn.db,
      new DbSchema<ItemRow>(
        "items",
        { id: t.serial().primary, name: t.text().notNull },
        sqliteDialect,
      ),
    );
    await items.create();
    await items.insert({ name: "seed" } as ItemRow);
    reader = new SQL(`sqlite://${conn.filename}`, { max: 1 });
  });

  afterAll(async () => {
    await reader.close();
    await conn.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("a second connection reads the committed snapshot while a write transaction is open", async () => {
    const readerCount = async (): Promise<number> => {
      const [row] = await reader<{ total: number }[]>`
        SELECT COUNT(*) AS total FROM "items"
      `;
      return Number(row?.total);
    };

    const during = await conn.db.begin(async (tx) => {
      const writer = items.withContext(tx);
      await writer.insert({ name: "a" } as ItemRow);
      await writer.insert({ name: "b" } as ItemRow);
      await writer.insert({ name: "c" } as ItemRow);

      // WAL lets the reader see the pre-transaction snapshot without blocking.
      return readerCount();
    });

    expect(during).toBe(1);
    expect(await readerCount()).toBe(4);
    expect(await items.count()).toBe(4);
  });
});
