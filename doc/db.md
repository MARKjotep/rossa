# Database adapters

Rossa's database layer provides typed schemas and a repository API over Bun's
SQL client. SQLite works without an additional driver dependency.

`DbRepository<T>` contains shared CRUD and transaction behavior. A
`DbDialectAdapter` supplies database-specific column types, DDL, upsert,
inspection, truncation, and optimization. See the
[dialect guide](../src/db/dialects/README.md) for the steps to add a backend.

```ts
import type { SQL } from "bun";
import { DbRepository, DbSchema, sqliteDialect, t } from "@/db";

interface UserRow {
  id: number;
  name: string;
}

const schema = new DbSchema<UserRow>(
  "users",
  {
    id: t.serial().primary,
    name: t.text().notNull,
  },
  sqliteDialect,
);

declare const db: SQL; // Bun SQL connection configured for SQLite
const users = new DbRepository<UserRow>(db, schema);
await users.create();
```

## CRUD and queries

Use the repository for typed, parameterized CRUD operations:

```ts
const created = await users.insert({ id: 0, name: "Rosa" });
const rosa = await users.find({ name: "Rosa" });
const matching = await users.findAll({
  name: { operator: "LIKE", value: "R%" },
});
const page = await users.paginate(1, 20, { name: "Rosa" });
const updated = await users.update({ id: 1 }, { name: "Rosa M." });
const removed = await users.delete({ id: 1 });
```

`findAll()`, `count()`, and `exists()` accept the same typed conditions.
Conditions combine with `AND`; operators include comparisons, `LIKE`, `IN`,
and `IS`. Values are bound as parameters. Keep table and column names in
trusted schema definitions.

## Schema changes

`create()` creates the table if needed. `syncColumns()` adds missing columns
and keeps existing ones by default. Pass `true` only when dropping columns is
intentional, since that can destroy data:

```ts
await users.syncColumns();
// await users.syncColumns(true); // Also drop columns missing from the schema.
```

Create an equivalent schema with `postgresDialect`, `mysqlDialect`, or
`mariadbDialect` for PostgreSQL, MySQL, or MariaDB. `getDialect("mysql")` and
`getDialect("mariadb")` are also available. Bun's `mysql2://` URL is compatible
with `mysqlDialect`. The schema uses logical types (`t.int()`, `t.json()`,
`t.timestamp()`, and others); the selected adapter maps them to the database's
native column types. See the [dialect guide](../src/db/dialects/README.md) for MySQL
write behavior and current limitations.
