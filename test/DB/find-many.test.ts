import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import type { SQL as SQLClient } from "bun";
import { DbRepository, DbSchema, sqliteDialect, t, type Where } from "@/db";

interface MessageRow {
  id: number;
  topic: string;
  body: string;
  score: number;
}

function messageSchema(table = "find_many_messages"): DbSchema<MessageRow> {
  return new DbSchema<MessageRow>(
    table,
    {
      id: t.serial().primary,
      topic: t.text().notNull,
      body: t.text().notNull,
      score: t.int().notNull.default(0),
    },
    sqliteDialect,
  );
}

/** Inserts are partial on purpose: SQLite supplies the serial id and defaults. */
const asMessage = (row: Partial<MessageRow>): MessageRow => row as MessageRow;

const SEEDS: ReadonlyArray<Partial<MessageRow>> = [
  { topic: "chat", body: "one", score: 10 },
  { topic: "chat", body: "two", score: 20 },
  { topic: "chat", body: "three", score: 30 },
  { topic: "chat", body: "four", score: 40 },
  { topic: "news", body: "five", score: 50 },
];

describe("DbRepository.findMany", () => {
  let db: SQLClient;
  let messages: DbRepository<MessageRow>;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    messages = new DbRepository(db, messageSchema());
    await messages.create();
  });

  beforeEach(async () => {
    await messages.inspect.truncateTable();
    for (const seed of SEEDS) await messages.insert(asMessage(seed));
  });

  afterAll(async () => {
    await db.close();
  });

  test("returns every row when called without options", async () => {
    const rows = await messages.findMany();

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => row.body).sort()).toEqual([
      "five",
      "four",
      "one",
      "three",
      "two",
    ]);
    expect(await messages.findMany({})).toHaveLength(5);
  });

  test("reads the latest N rows for a topic in descending order", async () => {
    const rows = await messages.findMany({
      where: { topic: "chat" },
      orderBy: { column: "id", direction: "desc" },
      limit: 3,
    });

    expect(rows.map((row) => row.body)).toEqual(["four", "three", "two"]);
    expect(rows.map((row) => row.id)).toEqual([4, 3, 2]);
  });

  test("sorts ascending by default and honors an explicit asc direction", async () => {
    const implicit = await messages.findMany({
      where: { topic: "chat" },
      orderBy: { column: "score" },
      limit: 2,
    });
    const explicit = await messages.findMany({
      where: { topic: "chat" },
      orderBy: { column: "score", direction: "asc" },
      limit: 2,
    });

    expect(implicit.map((row) => row.score)).toEqual([10, 20]);
    expect(explicit.map((row) => row.score)).toEqual([10, 20]);
  });

  test("supports ordering without a filter and filtering without an order", async () => {
    const newest = await messages.findMany({
      orderBy: { column: "id", direction: "desc" },
      limit: 2,
    });
    expect(newest.map((row) => row.id)).toEqual([5, 4]);

    const chat = await messages.findMany({ where: { topic: "chat" } });
    expect(chat).toHaveLength(4);
    expect(chat.every((row) => row.topic === "chat")).toBe(true);
  });

  test("returns fewer rows when the limit exceeds the match count", async () => {
    const rows = await messages.findMany({
      where: { topic: "news" },
      limit: 50,
    });
    expect(rows).toHaveLength(1);
    expect(await messages.findMany({ limit: 100 })).toHaveLength(5);
  });

  test("supports operator filters through findMany", async () => {
    const rows = await messages.findMany({
      where: { score: { operator: ">=", value: 30 } },
      orderBy: { column: "score", direction: "desc" },
      limit: 3,
    });

    expect(rows.map((row) => row.score)).toEqual([50, 40, 30]);
  });

  test("rejects non-positive and non-integer limits", async () => {
    const invalid = [0, -1, -10, 1.5, Number.NaN, Number.POSITIVE_INFINITY];

    for (const limit of invalid) {
      await expect(messages.findMany({ limit })).rejects.toThrow(RangeError);
    }

    await expect(
      messages.findMany({ limit: "3" as unknown as number }),
    ).rejects.toThrow(RangeError);

    // Rejected calls never reach the database.
    expect(await messages.count()).toBe(5);
  });

  test("rejects unknown where and orderBy columns before running SQL", async () => {
    await expect(
      messages.findMany({
        where: { missing: "x" } as unknown as Where<MessageRow>,
      }),
    ).rejects.toThrow("Unknown column 'missing'");

    await expect(
      messages.findMany({
        orderBy: { column: "missing" as keyof MessageRow & string },
      }),
    ).rejects.toThrow("Unknown column 'missing'");
  });

  test("allowlists column and direction strings instead of interpolating them", async () => {
    const injectedColumn = 'id"; DROP TABLE find_many_messages; --';
    const injectedDirection = "asc; DROP TABLE find_many_messages; --";

    await expect(
      messages.findMany({
        orderBy: { column: injectedColumn as keyof MessageRow & string },
      }),
    ).rejects.toThrow(TypeError);

    await expect(
      messages.findMany({
        orderBy: {
          column: "id",
          direction: injectedDirection as "asc" | "desc",
        },
      }),
    ).rejects.toThrow(TypeError);

    await expect(
      messages.findMany({
        where: { 'id" = 1; DROP TABLE find_many_messages; --': 1 } as unknown as Where<MessageRow>,
      }),
    ).rejects.toThrow(TypeError);

    await expect(
      messages.findMany({
        where: {
          score: { operator: "OR 1=1; DROP TABLE find_many_messages", value: 1 },
        },
      }),
    ).rejects.toThrow(TypeError);

    // The table survived every injection attempt.
    expect(await messages.count()).toBe(5);
    expect(await messages.inspect.listTables()).toContain(
      "find_many_messages",
    );
  });

  test("keeps find, findAll, and paginate behavior unchanged", async () => {
    expect((await messages.find({ topic: "news" }))?.body).toBe("five");
    expect(
      (await messages.findAll({ topic: "news" })).map((row) => row.body),
    ).toEqual(["five"]);
    expect((await messages.paginate(2, 2)).map((row) => row.id)).toEqual([3, 4]);
  });
});
