import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { SQL } from "bun";
import type { SQL as SQLClient } from "bun";
import { DbRepository, DbSchema, sqliteDialect, t } from "@/db";

interface UserRow {
  id: number;
  name: string;
}

describe("DbRepository with SQLite", () => {
  let db: SQLClient;
  let users: DbRepository<UserRow>;

  beforeAll(async () => {
    db = new SQL(":memory:", { max: 1 });
    const schema = new DbSchema<UserRow>(
      "users",
      {
        id: t.serial().primary,
        name: t.text().notNull.unique,
      },
      sqliteDialect,
    );
    users = new DbRepository(db, schema);
    await users.create();
  });

  beforeEach(async () => {
    await users.inspect.truncateTable();
  });

  afterAll(async () => {
    await db.close();
  });

  test("creates a table and supports insert, find, update, and delete", async () => {
    await users.insert({ id: 1, name: "Ada" });

    expect(await users.find({ id: 1 })).toMatchObject({ id: 1, name: "Ada" });
    expect(await users.exists({ name: "Ada" })).toBe(true);
    expect(await users.count()).toBe(1);

    const updated = await users.update({ id: 1 }, { name: "Grace" });
    expect(updated[0]?.name).toBe("Grace");

    const deleted = await users.delete({ id: 1 });
    expect(deleted).toHaveLength(1);
    expect(await users.exists({ id: 1 })).toBe(false);
  });

  test("upserts on the selected conflict column", async () => {
    await users.insert({ id: 1, name: "Ada" });

    const row = await users.upsert({ id: 1, name: "Grace" }, "id");

    expect(row).toMatchObject({ id: 1, name: "Grace" });
    expect(await users.count()).toBe(1);
  });

  test("supports IN conditions and rejects empty destructive filters", async () => {
    await users.insert({ id: 1, name: "Ada" });
    await users.insert({ id: 2, name: "Grace" });

    expect(
      await users.findAll({ id: { operator: "IN", value: [1, 2] } }),
    ).toHaveLength(2);
    expect(
      await users.findAll({ id: { operator: "IN", value: [] } }),
    ).toHaveLength(0);
    await expect(users.update({}, { name: "Nobody" })).rejects.toThrow(
      "WHERE condition",
    );
    await expect(users.delete({})).rejects.toThrow("WHERE condition");
  });

  test("syncs a new column and exposes table inspection helpers", async () => {
    await users.insert({ id: 1, name: "Ada" });

    interface UserWithNickname extends UserRow {
      nickname: string;
    }
    const expanded = new DbRepository(
      db,
      new DbSchema<UserWithNickname>(
        "users",
        {
          id: t.serial().primary,
          name: t.text().notNull.unique,
          nickname: t.text(),
        },
        sqliteDialect,
      ),
    );

    await expanded.syncColumns();
    const columns = await expanded.inspect.getTableSchema();
    const stats = await expanded.inspect.getTableStats();

    expect(columns.map((column: { name: string }) => column.name)).toContain(
      "nickname",
    );
    expect(stats.rowCount).toBe(1);
    expect(await expanded.inspect.getTableData()).toHaveLength(1);
  });
});
