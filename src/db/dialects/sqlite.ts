import { sql, type SQL } from "bun";
import type { Column } from "../column";
import type { DbDialectAdapter, TableStats } from "./dialect";
import { quoteIdentifier, quoteTable, tableParts } from "../identifier";
import type { DbSchema, DbSchemaIndex } from "../schema";

function tableFragment(schema: DbSchema<any>) {
  return sql.unsafe(quoteTable(schema.table));
}

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(2)} ${SIZE_UNITS[unit]}`;
}

function joinSql(fragments: any[]) {
  return fragments.reduce((left, right, index) =>
    index === 0 ? right : sql`${left}, ${right}`,
  );
}

function renderDefault(column: Column): string {
  if (!column.hasDefault) return "";
  if (column.defaultIsCurrentTimestamp) return " DEFAULT CURRENT_TIMESTAMP";
  if (typeof column.defaultValue === "string") {
    return ` DEFAULT '${column.defaultValue.replace(/'/g, "''")}'`;
  }
  if (typeof column.defaultValue === "boolean") {
    return ` DEFAULT ${column.defaultValue ? 1 : 0}`;
  }
  return ` DEFAULT ${column.defaultValue}`;
}

function renderType(column: Column): string {
  switch (column.type) {
    case "text":
    case "json":
    case "timestamp":
      return "TEXT";
    case "integer":
    case "bigint":
    case "serial":
      return "INTEGER";
    case "boolean":
      return "INTEGER";
    case "numeric":
      return "REAL";
  }
}

function assertAutoIncrement(column: Column): void {
  if (column.isAutoIncrement && !column.primaryKey) {
    throw new Error(
      "SQLite AUTOINCREMENT requires the column to be the primary key.",
    );
  }
}

function renderPrimaryKey(column: Column): string {
  if (!column.primaryKey) return "";
  return column.isAutoIncrement ? "PRIMARY KEY AUTOINCREMENT" : "PRIMARY KEY";
}

function renderColumn(name: string, column: Column): string {
  assertAutoIncrement(column);
  return [
    quoteIdentifier(name),
    renderType(column),
    renderPrimaryKey(column),
    column.required ? "NOT NULL" : "",
    column.isUnique ? "UNIQUE" : "",
    renderDefault(column).trim(),
  ]
    .filter(Boolean)
    .join(" ");
}

function createIndexSQL(table: string, index: DbSchemaIndex): string {
  // SQLite takes the schema on the index name, not on the table name.
  const [database, tableName] = tableParts(table);
  const indexName = database
    ? `${quoteIdentifier(database)}.${quoteIdentifier(index.name)}`
    : quoteIdentifier(index.name);
  return `CREATE ${index.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${indexName} ON ${quoteIdentifier(tableName)} (${index.columns
    .map((column) => quoteIdentifier(column))
    .join(", ")});`;
}

async function createIndex(
  db: SQL,
  schema: DbSchema<any>,
  index: DbSchemaIndex,
): Promise<void> {
  await db`${sql.unsafe(createIndexSQL(schema.table, index))}`;
}

async function getColumns(db: SQL, schema: DbSchema<any>): Promise<string[]> {
  const [database, table] = tableParts(schema.table);
  const pragmaDatabase = database ? `${quoteIdentifier(database)}.` : "";
  const rows = await db<{ name: string }[]>`${sql.unsafe(
    `PRAGMA ${pragmaDatabase}table_info(${quoteIdentifier(table)})`,
  )}`;
  return rows.map((row) => row.name);
}

export const sqliteDialect: DbDialectAdapter = {
  name: "sqlite",
  quoteIdentifier,
  quoteTable,
  normalizeColumnName(name) {
    return name.toLowerCase();
  },
  buildColumn: renderColumn,
  buildColumnType(column) {
    assertAutoIncrement(column);
    return [
      renderType(column),
      renderPrimaryKey(column),
      column.required ? "NOT NULL" : "",
      column.isUnique ? "UNIQUE" : "",
      renderDefault(column).trim(),
    ]
      .filter(Boolean)
      .join(" ");
  },
  normalizeOperator(operator) {
    return operator.toUpperCase() === "ILIKE" ? "LIKE" : operator.toUpperCase();
  },
  async version(db) {
    const [row] = await db<{ version: string }[]>`SELECT sqlite_version() AS version`;
    if (!row?.version) throw new Error("SQLite did not return its version.");
    return row.version;
  },
  async createTable(db, schema) {
    for (const statement of schema.createStatements(this)) {
      await db`${sql.unsafe(statement)}`;
    }
  },
  createIndexSQL,
  createIndex,
  getColumns,
  async addColumn(db, schema, name, type) {
    if (/\bPRIMARY KEY\b|\bUNIQUE\b/i.test(type)) {
      throw new Error(
        "SQLite cannot add PRIMARY KEY or UNIQUE constraints with ADD COLUMN; rebuild the table instead.",
      );
    }
    await db`${sql.unsafe(
      `ALTER TABLE ${quoteTable(schema.table)} ADD COLUMN ${quoteIdentifier(name)} ${type}`,
    )}`;
  },
  async dropColumn(db, schema, name) {
    await db`${sql.unsafe(
      `ALTER TABLE ${quoteTable(schema.table)} DROP COLUMN ${quoteIdentifier(name)}`,
    )}`;
  },
  async upsert<T extends Record<string, any>>(db: SQL, schema: DbSchema<T>, data: T, conflictColumn: keyof T) {
    const keys = Object.keys(data);
    if (keys.length === 0) throw new Error("Upsert requires at least one column value.");
    const conflictName = String(conflictColumn);
    const updates = keys.filter((key) => key !== conflictName);
    const updateNames = updates.length ? updates : [conflictName];
    const assignments = joinSql(
      updateNames.map((name) =>
        sql`${sql.unsafe(quoteIdentifier(name))} = excluded.${sql.unsafe(quoteIdentifier(name))}`,
      ),
    );
    const [row] = await db<T[]>`
      INSERT INTO ${tableFragment(schema)} ${sql(data)}
      ON CONFLICT (${sql.unsafe(quoteIdentifier(conflictName))})
      DO UPDATE SET ${assignments}
      RETURNING *
    `;
    return row;
  },
  async listTables(db) {
    const rows = await db<{ name: string }[]>`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `;
    return rows.map((row) => row.name);
  },
  async dropTable(db, schema) {
    await db`${sql.unsafe(`DROP TABLE ${quoteTable(schema.table)}`)}`;
  },
  async truncateTable(db, schema) {
    await db.begin(async (tx) => {
      await tx`${sql.unsafe(`DELETE FROM ${quoteTable(schema.table)}`)}`;
      const [database, table] = tableParts(schema.table);
      const quotedDatabase = quoteIdentifier(database ?? "main");
      const [sequenceTable] = await tx<{ name: string }[]>`${sql.unsafe(
        `SELECT name FROM ${quotedDatabase}.sqlite_schema WHERE type = 'table' AND name = 'sqlite_sequence'`,
      )}`;
      if (sequenceTable) {
        await tx`${sql.unsafe(`DELETE FROM ${quotedDatabase}.sqlite_sequence WHERE name = `)}${table}`;
      }
    });
  },
  async getTableStats(db, schema): Promise<TableStats> {
    const [database, table] = tableParts(schema.table);
    const [count] = await db<{ total: number }[]>`
      SELECT COUNT(*) AS total FROM ${tableFragment(schema)}
    `;
    const pragmaDatabase = database ? `${quoteIdentifier(database)}.` : "";
    const indices = await db`${sql.unsafe(
      `PRAGMA ${pragmaDatabase}index_list(${quoteIdentifier(table)})`,
    )}`;
    const [pageCount] = await db<{ page_count: number }[]>`
      ${sql.unsafe("PRAGMA page_count")}
    `;
    const [pageSize] = await db<{ page_size: number }[]>`
      ${sql.unsafe("PRAGMA page_size")}
    `;
    return {
      rowCount: Number(count?.total ?? 0),
      diskSize: formatBytes(
        Number(pageCount?.page_count ?? 0) * Number(pageSize?.page_size ?? 0),
      ),
      indexCount: indices.length,
    };
  },
  async getTableIndices(db, schema) {
    const [database, table] = tableParts(schema.table);
    const pragmaDatabase = database ? `${quoteIdentifier(database)}.` : "";
    const indices = await db<Record<string, unknown>[]>`${sql.unsafe(
      `PRAGMA ${pragmaDatabase}index_list(${quoteIdentifier(table)})`,
    )}`;
    const rows: Array<Record<string, unknown>> = [];
    for (const index of indices) {
      const info = await db<{ name: string | null }[]>`${sql.unsafe(
        `PRAGMA ${pragmaDatabase}index_info(${quoteIdentifier(String(index.name))})`,
      )}`;
      rows.push({
        ...index,
        columns: info
          .map((column) => column.name)
          .filter((name): name is string => typeof name === "string"),
      });
    }
    return rows;
  },
  async getTableSchema(db, schema) {
    const [database, table] = tableParts(schema.table);
    const pragmaDatabase = database ? `${quoteIdentifier(database)}.` : "";
    return db`${sql.unsafe(
      `PRAGMA ${pragmaDatabase}table_info(${quoteIdentifier(table)})`,
    )}`;
  },
  async getTableData(db, schema, limit, offset) {
    return await db`
      SELECT * FROM ${tableFragment(schema)}
      LIMIT ${limit} OFFSET ${offset}
    `;
  },
  async optimize(db) {
    await db`${sql.unsafe("PRAGMA optimize")}`;
    await db`${sql.unsafe("VACUUM")}`;
  },
};
