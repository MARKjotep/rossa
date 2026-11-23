import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import type { SQL as SQLClient } from "bun";
import {
  DbRepository,
  DbSchema,
  UniqueConstraintError,
  type Column,
  mysqlDialect,
  postgresDialect,
  sqliteDialect,
  t,
} from "@/db";

interface MessageRow {
  id: number;
  topic: string;
  body: string;
}

const MESSAGE_INDICES: Array<{
  name: string;
  columns: string[];
  unique?: boolean;
}> = [
  { name: "messages_topic_id", columns: ["topic", "id"] },
  { name: "messages_topic_body", columns: ["topic", "body"], unique: true },
];

function messageSchema(table = "indexed_messages"): DbSchema<MessageRow> {
  return new DbSchema<MessageRow>(
    table,
    {
      id: t.serial().primary.autoIncrement(),
      topic: t.text().notNull,
      body: t.text().notNull,
    },
    sqliteDialect,
    { indices: [...MESSAGE_INDICES] },
  );
}

const asMessage = (row: Partial<MessageRow>): MessageRow => row as MessageRow;

describe("DbSchema declarative indexes (SQLite)", () => {
  let db: SQLClient;
  let messages: DbRepository<MessageRow>;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    messages = new DbRepository(db, messageSchema());
    await messages.create();
  });

  beforeEach(async () => {
    await messages.inspect.truncateTable();
  });

  afterAll(async () => {
    await db.close();
  });

  test("createSQL emits idempotent CREATE [UNIQUE] INDEX statements", () => {
    const sql = messageSchema().createSQL();

    expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "messages_topic_id" ON "indexed_messages" ("topic", "id");',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "messages_topic_body" ON "indexed_messages" ("topic", "body");',
    );
  });

  test("leaves DDL unchanged when no indexes are declared", () => {
    const plain = new DbSchema<MessageRow>(
      "plain_messages",
      {
        id: t.serial().primary,
        topic: t.text().notNull,
        body: t.text().notNull,
      },
      sqliteDialect,
    );

    expect(plain.createSQL()).not.toContain("INDEX");
    expect(plain.indices).toEqual([]);
  });

  test("repo.create applies indexes reported by the inspector", async () => {
    const indices = await messages.inspect.getTableIndices();
    const byName = new Map(
      indices.map((index: { name: string }) => [index.name, index]),
    );

    const declared = byName.get("messages_topic_id") as
      | { unique: number | boolean; columns: string[] }
      | undefined;
    expect(declared).toBeDefined();
    expect(declared!.columns).toEqual(["topic", "id"]);
    expect(Number(declared!.unique)).toBe(0);

    const unique = byName.get("messages_topic_body") as
      | { unique: number | boolean; columns: string[] }
      | undefined;
    expect(unique).toBeDefined();
    expect(unique!.columns).toEqual(["topic", "body"]);
    expect(Number(unique!.unique)).toBe(1);
  });

  test("re-running create() is a no-op", async () => {
    const before = await messages.inspect.getTableIndices();
    await messages.create();
    await messages.create();
    const after = await messages.inspect.getTableIndices();

    expect(after).toHaveLength(before.length);
    expect(
      after.filter((index: { name: string }) =>
        MESSAGE_INDICES.some((declared) => declared.name === index.name),
      ),
    ).toHaveLength(MESSAGE_INDICES.length);

    await messages.insert(asMessage({ topic: "chat", body: "still works" }));
    expect(await messages.count()).toBe(1);
  });

  test("unique indexes enforce uniqueness through the repository", async () => {
    await messages.insert(asMessage({ topic: "chat", body: "hello" }));

    let error: unknown;
    try {
      await messages.insert(asMessage({ topic: "chat", body: "hello" }));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(UniqueConstraintError);
    expect(await messages.count()).toBe(1);

    // A different body is still accepted.
    await messages.insert(asMessage({ topic: "chat", body: "other" }));
    expect(await messages.count()).toBe(2);
  });

  test("applies declared indexes to schema-qualified tables", async () => {
    const qualified = new DbRepository(
      db,
      new DbSchema<MessageRow>(
        "main.indexed_qualified",
        {
          id: t.serial().primary,
          topic: t.text().notNull,
          body: t.text().notNull,
        },
        sqliteDialect,
        { indices: [{ name: "qualified_topic", columns: ["topic"] }] },
      ),
    );

    await qualified.create();
    await qualified.create();

    const index = (await qualified.inspect.getTableIndices()).find(
      (row: { name: string }) => row.name === "qualified_topic",
    );
    expect(index?.columns).toEqual(["topic"]);
    expect(await qualified.inspect.listTables()).toContain("indexed_qualified");

    await qualified.inspect.dropTable();
  });

  test("autoIncrement ids are never reused after deleting the newest row", async () => {
    const first = await messages.insert(asMessage({ topic: "t", body: "a" }));
    const second = await messages.insert(asMessage({ topic: "t", body: "b" }));
    const third = await messages.insert(asMessage({ topic: "t", body: "c" }));

    expect([first!.id, second!.id, third!.id]).toEqual([1, 2, 3]);

    await messages.delete({ id: third!.id });
    const fourth = await messages.insert(asMessage({ topic: "t", body: "d" }));

    // AUTOINCREMENT (unlike a plain rowid) does not reuse the deleted id.
    expect(fourth!.id).toBe(4);
  });
});

describe("DbSchema index and autoIncrement validation", () => {
  const columns = (): Record<keyof MessageRow, Column> => ({
    id: t.serial().primary,
    topic: t.text().notNull,
    body: t.text().notNull,
  });

  test("rejects malformed index declarations at construction time", () => {
    expect(
      () =>
        new DbSchema<MessageRow>("bad_indexes", columns(), sqliteDialect, {
          indices: [{ name: "bad", columns: ["missing"] }],
        }),
    ).toThrow('unknown column \'missing\'');

    expect(
      () =>
        new DbSchema<MessageRow>("bad_indexes", columns(), sqliteDialect, {
          indices: [{ name: "bad", columns: [] }],
        }),
    ).toThrow("must declare at least one column");

    expect(
      () =>
        new DbSchema<MessageRow>("bad_indexes", columns(), sqliteDialect, {
          indices: [
            { name: "dup", columns: ["topic"] },
            { name: "dup", columns: ["body"] },
          ],
        }),
    ).toThrow("Duplicate index name");

    expect(
      () =>
        new DbSchema<MessageRow>("bad_indexes", columns(), sqliteDialect, {
          indices: [
            {
              name: "bad_flag",
              columns: ["topic"],
              unique: "yes" as unknown as boolean,
            },
          ],
        }),
    ).toThrow("non-boolean 'unique' flag");

    expect(
      () =>
        new DbSchema<MessageRow>("bad_indexes", columns(), sqliteDialect, {
          indices: [{ name: "", columns: ["topic"] }],
        }),
    ).toThrow("non-empty strings");
  });

  test("autoIncrement only applies to integer-like columns and needs a primary key on SQLite", () => {
    expect(() => t.text().autoIncrement()).toThrow(TypeError);
    expect(() => t.boolean().autoIncrement()).toThrow(TypeError);

    const noPrimary = new DbSchema<{ id: number }>(
      "auto_without_key",
      { id: t.serial().autoIncrement() },
      sqliteDialect,
    );
    expect(() => noPrimary.createSQL()).toThrow(
      "SQLite AUTOINCREMENT requires the column to be the primary key",
    );
  });

  test("renders dialect-appropriate autoIncrement DDL", () => {
    const serialPostgres = new DbSchema<{ id: number }>(
      "pg_serial",
      { id: t.serial().primary.autoIncrement() },
      postgresDialect,
    );
    expect(serialPostgres.createSQL()).toContain('"id" SERIAL PRIMARY KEY');
    expect(serialPostgres.createSQL()).not.toContain("IDENTITY");

    const integerPostgres = new DbSchema<{ id: number }>(
      "pg_identity",
      { id: t.int().primary.autoIncrement() },
      postgresDialect,
    );
    expect(integerPostgres.createSQL()).toContain(
      '"id" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY',
    );

    const serialMysql = new DbSchema<{ id: number }>(
      "mysql_serial",
      { id: t.serial().primary.autoIncrement() },
      mysqlDialect,
    );
    expect(serialMysql.createSQL()).toContain(
      "`id` BIGINT AUTO_INCREMENT PRIMARY KEY",
    );

    const integerMysql = new DbSchema<{ id: number }>(
      "mysql_increment",
      { id: t.int().primary.autoIncrement() },
      mysqlDialect,
    );
    expect(integerMysql.createSQL()).toContain("`id` INT AUTO_INCREMENT PRIMARY KEY");
  });

  test("withDialect keeps declared indexes and renders them per dialect", () => {
    const schema = new DbSchema<MessageRow>(
      "dialect_messages",
      {
        id: t.serial().primary,
        topic: t.text().notNull,
        body: t.text().notNull,
      },
      sqliteDialect,
      { indices: [...MESSAGE_INDICES] },
    );

    expect(schema.withDialect(postgresDialect).indices).toEqual(
      schema.indices,
    );

    const postgres = schema.withDialect(postgresDialect).createSQL();
    expect(postgres).toContain(
      'CREATE INDEX IF NOT EXISTS "messages_topic_id" ON "dialect_messages" ("topic", "id");',
    );

    const mysql = schema.withDialect(mysqlDialect).createSQL();
    // MySQL has no CREATE INDEX IF NOT EXISTS; the adapter checks first.
    expect(mysql).toContain(
      "CREATE INDEX `messages_topic_id` ON `dialect_messages` (`topic`, `id`);",
    );
    expect(mysql).not.toContain("IF NOT EXISTS `messages_topic_id`");
  });
});
