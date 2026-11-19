import { sql, type SQL } from "bun";
import type { Column } from "../column";
import type { DbDialectAdapter, TableStats } from "./dialect";
import { quoteIdentifier, quoteTable, tableParts } from "../identifier";
import type { Schema } from "../schema";

function tableFragment(schema: Schema<any>) {
  return sql.unsafe(quoteTable(schema.table));
}

function renderDefault(column: Column): string {
  if (!column.hasDefault) return "";
  if (column.defaultIsCurrentTimestamp) return " DEFAULT CURRENT_TIMESTAMP";
  if (typeof column.defaultValue === "string") {
    return ` DEFAULT '${column.defaultValue.replace(/'/g, "''")}'`;
  }
  return ` DEFAULT ${column.defaultValue}`;
}

function renderType(column: Column): string {
  switch (column.type) {
    case "text":
      return "TEXT";
    case "integer":
      return "INTEGER";
    case "bigint":
      return "BIGINT";
    case "boolean":
      return "BOOLEAN";
    case "json":
      return "JSONB";
    case "timestamp":
      return "TIMESTAMPTZ";
    case "serial":
      return "SERIAL";
    case "numeric":
      return `NUMERIC(${column.precision ?? 10}, ${column.scale ?? 2})`;
  }
}

function renderColumn(name: string, column: Column): string {
  return [
    quoteIdentifier(name),
    renderType(column),
    column.primaryKey ? "PRIMARY KEY" : "",
    column.required ? "NOT NULL" : "",
    column.isUnique ? "UNIQUE" : "",
    renderDefault(column).trim(),
  ]
    .filter(Boolean)
    .join(" ");
}

async function getColumns(db: SQL, schema: Schema<any>): Promise<string[]> {
  const [schemaName, tableName] = tableParts(schema.table);
  const rows = schemaName
    ? await db<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = ${schemaName} AND table_name = ${tableName}
      `
    : await db<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ${tableName}
      `;
  return rows.map((row) => row.column_name);
}

export const postgresDialect: DbDialectAdapter = {
  name: "postgres",
  quoteIdentifier,
  quoteTable,
  normalizeColumnName(name) {
    return name;
  },
  buildColumn: renderColumn,
  buildColumnType(column) {
    return [
      renderType(column),
      column.primaryKey ? "PRIMARY KEY" : "",
      column.required ? "NOT NULL" : "",
      column.isUnique ? "UNIQUE" : "",
      renderDefault(column).trim(),
    ]
      .filter(Boolean)
      .join(" ");
  },
  normalizeOperator(operator) {
    return operator.toUpperCase();
  },
  async version(db) {
    const [row] = await db<{ version: string }[]>`SELECT version() AS version`;
    if (!row?.version)
      throw new Error("PostgreSQL did not return its version.");
    return row.version;
  },
  async createTable(db, schema) {
    await db`${sql.unsafe(schema.createSQL(this))}`;
  },
  getColumns,
  async addColumn(db, schema, name, type) {
    await db`${sql.unsafe(
      `ALTER TABLE ${quoteTable(schema.table)} ADD COLUMN ${quoteIdentifier(name)} ${type}`,
    )}`;
  },
  async dropColumn(db, schema, name) {
    await db`${sql.unsafe(
      `ALTER TABLE ${quoteTable(schema.table)} DROP COLUMN ${quoteIdentifier(name)}`,
    )}`;
  },
  async upsert<T extends Record<string, any>>(
    db: SQL,
    schema: Schema<T>,
    data: T,
    conflictColumn: keyof T,
  ) {
    if (Object.keys(data).length === 0)
      throw new Error("Upsert requires at least one column value.");
    const [row] = await db<T[]>`
      INSERT INTO ${tableFragment(schema)} ${sql(data)}
      ON CONFLICT (${sql.unsafe(quoteIdentifier(String(conflictColumn)))})
      DO UPDATE SET ${sql(data)}
      RETURNING *
    `;
    return row;
  },
  async listTables(db) {
    const rows = await db<{ tablename: string }[]>`
      SELECT tablename FROM pg_catalog.pg_tables
      WHERE schemaname = current_schema()
    `;
    return rows.map((row) => row.tablename);
  },
  async dropTable(db, schema) {
    await db`${sql.unsafe(`DROP TABLE ${quoteTable(schema.table)}`)}`;
  },
  async truncateTable(db, schema) {
    await db`${sql.unsafe(`TRUNCATE TABLE ${quoteTable(schema.table)} RESTART IDENTITY`)}`;
  },
  async getTableStats(db, schema): Promise<TableStats> {
    const [schemaName, tableName] = tableParts(schema.table);
    const [count] = await db<{ total: number }[]>`
      SELECT COUNT(*) AS total FROM ${tableFragment(schema)}
    `;
    const relationName = quoteTable(schema.table);
    const [stats] = await db<{ size: string; index_count: number }[]>`
      SELECT
        pg_size_pretty(pg_total_relation_size(${relationName}::regclass)) AS size,
        (SELECT COUNT(*) FROM pg_indexes
         WHERE schemaname = COALESCE(${schemaName ?? null}, current_schema())
           AND tablename = ${tableName}) AS index_count
    `;
    return {
      rowCount: Number(count?.total ?? 0),
      diskSize: stats?.size ?? "unknown",
      indexCount: Number(stats?.index_count ?? 0),
    };
  },
  async getTableIndices(db, schema) {
    const [schemaName, tableName] = tableParts(schema.table);
    return schemaName
      ? db`
          SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = ${schemaName} AND tablename = ${tableName}
        `
      : db`
          SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = current_schema() AND tablename = ${tableName}
        `;
  },
  async getTableSchema(db, schema) {
    const [schemaName, tableName] = tableParts(schema.table);
    return schemaName
      ? db`
          SELECT column_name, data_type, column_default, is_nullable
          FROM information_schema.columns
          WHERE table_schema = ${schemaName} AND table_name = ${tableName}
        `
      : db`
          SELECT column_name, data_type, column_default, is_nullable
          FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = ${tableName}
        `;
  },
  async getTableData(db, schema, limit, offset) {
    return await db`
      SELECT * FROM ${tableFragment(schema)}
      LIMIT ${limit} OFFSET ${offset}
    `;
  },
  async optimize(db, schema) {
    await db.unsafe(`VACUUM ANALYZE ${quoteTable(schema.table)}`);
  },
};
