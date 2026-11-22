# Adding a database dialect

Each dialect is an adapter implementing [`DbDialectAdapter`](./dialect.ts).
`DbRepository` keeps the shared CRUD and transaction API; the adapter owns SQL
that varies by database, while `DbSchema` asks the adapter to render identifiers
and logical column definitions.

## 1. Add an adapter module

Create `src/db/dialects/<name>.ts` and export one adapter value. Use the shared
identifier helpers where they fit, or provide database-correct quoting in the
adapter:

```ts
import { sql, type SQL } from "bun";
import type { Column } from "../column";
import type { DbDialectAdapter } from "./dialect";
import { quoteIdentifier, quoteTable } from "../identifier";
import type { DbSchema } from "../schema";

export const exampleDialect: DbDialectAdapter = {
  name: "example",
  quoteIdentifier,
  quoteTable,
  normalizeColumnName: (name) => name,
  normalizeOperator: (operator) => operator.toUpperCase(),

  buildColumn(name: string, column: Column) {
    // Map each ColumnType to this database's SQL type and render its flags.
    return `${quoteIdentifier(name)} /* database type and constraints */`;
  },
  buildColumnType(column: Column) {
    // Render the type and constraints for ALTER TABLE ADD COLUMN.
    return "/* database type and constraints */";
  },

  async version(db: SQL) {
    // Return a database version string or throw a useful error.
    return "";
  },
  async createTable(db: SQL, schema: DbSchema<any>) {
    await db`${sql.unsafe(schema.createSQL(this))}`;
  },
  // Implement the remaining methods from DbDialectAdapter.
};
```

The snippet shows the shape only; the `/* ... */` placeholders are not valid
column definitions. The TypeScript interface lists every required method.

## 2. Map logical column types

`Column` stores logical types rather than database SQL:

| `ColumnType` | Meaning |
| --- | --- |
| `text` | Text/string data |
| `integer` | Standard integer |
| `bigint` | Large integer |
| `boolean` | Boolean value |
| `json` | JSON document |
| `timestamp` | Timestamp |
| `serial` | Generated integer primary key type |
| `numeric` | Fixed precision/scale number |

Implement both `buildColumn` and `buildColumnType`. The first renders a full
column for `CREATE TABLE`; the second renders the type and constraints used by
`syncColumns`. Be explicit about defaults and boolean representation, and
validate any precision or scale values before interpolating them into SQL.

## 3. Implement dialect-specific operations

The adapter contract requires these behaviors:

- Identifier quoting, column-name normalization, and operator normalization.
- Version lookup, table creation, column introspection, add/drop column, and
  upsert.
- Table listing, dropping, truncation, statistics, index/schema inspection,
  paginated table data, and optimization.

Use bound parameters for values. Only use `sql.unsafe` for SQL assembled from
quoted identifiers or fixed SQL syntax; never insert user values into raw SQL.
Keep destructive behavior conservative: `truncateTable` should not cascade to
other tables unless that behavior is explicitly part of the API.

## 4. Register and export it

Update all of these locations:

1. Add the name to `DbDialectName` in `dialect.ts`.
2. Import the adapter and add it to the map in `registry.ts`.
3. Export the adapter from `src/db/index.ts`.

Then construct a schema with that adapter:

```ts
const schema = new DbSchema<MyRow>("my_table", columns, exampleDialect);
const repository = new DbRepository<MyRow>(db, schema);
```

## Bun SQL backends

Bun SQL supports SQLite, PostgreSQL, MySQL, and MariaDB. `getDialect("mysql")`
and `getDialect("mariadb")` both use the MySQL-family implementation because
the engines share the SQL syntax used by this repository. Bun's `mysql2://`
connection URL is also MySQL and uses `mysqlDialect`.

MySQL does not support `RETURNING` for the repository's write operations. For
MySQL and MariaDB, inserts use Bun SQL's `lastInsertRowid` to load generated
records, while update and delete lock matching rows in a transaction so those
methods can continue returning affected records. Updated records reflect the
submitted values; trigger-generated and other server-side changes are not
re-read by this compatibility path.

The adapters cover the repository's current common schema, inspection, and
CRUD operations. Engine-specific features such as foreign-key declarations,
specialized index DDL, and migration-safe schema alterations can be added as
the API grows.

## 5. Add SQLite-backed tests

Add adapter tests alongside the implementation or in the project test folder.
For SQLite, use `new SQL(":memory:", { max: 1 })`, create a schema with the new
adapter, and close the client after each suite. Cover at least schema creation,
CRUD, upsert, `syncColumns`, inspection, and transaction behavior. For a
backend that needs a service, also add an integration test against that engine.
