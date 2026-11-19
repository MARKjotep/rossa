import { sql, type SQL } from "bun";
import type { Column } from "../column";
import type { DbDialectAdapter, DbDialectName, TableStats } from "./dialect";
import { tableParts } from "../identifier";
import type { Schema } from "../schema";

const quoteIdentifier = (name: string): string => {
  if (!name || name.includes("\0")) {
    throw new Error(
      "SQL identifiers must be non-empty and cannot contain NUL.",
    );
  }
  return "`" + name.replace(/`/g, "``") + "`";
};
const quoteTable = (value: string) => {
  const parts = value.split(".");
  if (parts.length > 2 || parts.some((part) => !part || part.includes("\0")))
    throw new Error(
      "Table names must be a table name or a schema-qualified table name.",
    );
  return parts.map(quoteIdentifier).join(".");
};
const tableFragment = (schema: Schema<any>) =>
  sql.unsafe(quoteTable(schema.table));

function renderType(column: Column): string {
  switch (column.type) {
    case "text":
      return "TEXT";
    case "integer":
      return "INT";
    case "bigint":
      return "BIGINT";
    case "boolean":
      return "BOOLEAN";
    case "json":
      return "JSON";
    case "timestamp":
      return "DATETIME(3)";
    case "serial":
      return "BIGINT AUTO_INCREMENT";
    case "numeric":
      return `DECIMAL(${column.precision ?? 10}, ${column.scale ?? 2})`;
  }
}

function renderDefault(column: Column): string {
  if (!column.hasDefault) return "";
  if (column.defaultIsCurrentTimestamp) return " DEFAULT CURRENT_TIMESTAMP";
  if (typeof column.defaultValue === "string")
    return ` DEFAULT '${column.defaultValue.replace(/'/g, "''")}'`;
  if (typeof column.defaultValue === "boolean")
    return ` DEFAULT ${column.defaultValue ? 1 : 0}`;
  return ` DEFAULT ${column.defaultValue}`;
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
  const [database, table] = tableParts(schema.table);
  const rows = database
    ? await db<
        { COLUMN_NAME: string }[]
      >`SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = ${database} AND table_name = ${table}`
    : await db<
        { COLUMN_NAME: string }[]
      >`SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ${table}`;
  return rows.map((row) => row.COLUMN_NAME);
}

function makeMysqlDialect(name: DbDialectName): DbDialectAdapter {
  return {
    name,
    quoteIdentifier,
    quoteTable,
    normalizeColumnName(name) {
      return name.toLowerCase();
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
      return operator.toUpperCase() === "ILIKE"
        ? "LIKE"
        : operator.toUpperCase();
    },
    async version(db) {
      const [row] = await db<
        { version: string }[]
      >`SELECT VERSION() AS version`;
      if (!row?.version)
        throw new Error("MySQL-compatible server did not return its version.");
      return row.version;
    },
    async createTable(db, schema) {
      await db`${sql.unsafe(schema.createSQL(this))}`;
    },
    getColumns,
    async addColumn(db, schema, name, type) {
      await db`${sql.unsafe(`ALTER TABLE ${quoteTable(schema.table)} ADD COLUMN ${quoteIdentifier(name)} ${type}`)}`;
    },
    async dropColumn(db, schema, name) {
      await db`${sql.unsafe(`ALTER TABLE ${quoteTable(schema.table)} DROP COLUMN ${quoteIdentifier(name)}`)}`;
    },
    async upsert<T extends Record<string, any>>(
      db: SQL,
      schema: Schema<T>,
      data: T,
      conflictColumn: keyof T,
    ) {
      const keys = Object.keys(data);
      if (!keys.length)
        throw new Error("Upsert requires at least one column value.");
      const updates = keys.filter((key) => key !== String(conflictColumn));
      const assignments = updates.length
        ? updates
            .map(
              (key) =>
                `${quoteIdentifier(key)} = VALUES(${quoteIdentifier(key)})`,
            )
            .join(", ")
        : `${quoteIdentifier(String(conflictColumn))} = VALUES(${quoteIdentifier(String(conflictColumn))})`;
      await db`INSERT INTO ${tableFragment(schema)} ${sql(data)} ON DUPLICATE KEY UPDATE ${sql.unsafe(assignments)}`;
      const key = data[conflictColumn];
      if (key === undefined) return undefined;
      const [row] = await db<
        T[]
      >`SELECT * FROM ${tableFragment(schema)} WHERE ${sql.unsafe(quoteIdentifier(String(conflictColumn)))} = ${key} LIMIT 1`;
      return row;
    },
    async listTables(db) {
      const rows = await db<
        { TABLE_NAME: string }[]
      >`SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`;
      return rows.map((row) => row.TABLE_NAME);
    },
    async dropTable(db, schema) {
      await db`${sql.unsafe(`DROP TABLE ${quoteTable(schema.table)}`)}`;
    },
    async truncateTable(db, schema) {
      await db`${sql.unsafe(`TRUNCATE TABLE ${quoteTable(schema.table)}`)}`;
    },
    async getTableStats(db, schema): Promise<TableStats> {
      const [database, table] = tableParts(schema.table);
      const [count] = await db<
        { total: number }[]
      >`SELECT COUNT(*) AS total FROM ${tableFragment(schema)}`;
      const [stats] = database
        ? await db<
            { size: number | null; index_count: number }[]
          >`SELECT data_length + index_length AS size, (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = ${database} AND table_name = ${table}) AS index_count FROM information_schema.tables WHERE table_schema = ${database} AND table_name = ${table}`
        : await db<
            { size: number | null; index_count: number }[]
          >`SELECT data_length + index_length AS size, (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ${table}) AS index_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ${table}`;
      return {
        rowCount: Number(count?.total ?? 0),
        diskSize: stats?.size == null ? "unknown" : `${stats.size} bytes`,
        indexCount: Number(stats?.index_count ?? 0),
      };
    },
    async getTableIndices(db, schema) {
      const [database, table] = tableParts(schema.table);
      return database
        ? db`SELECT * FROM information_schema.statistics WHERE table_schema = ${database} AND table_name = ${table}`
        : db`SELECT * FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ${table}`;
    },
    async getTableSchema(db, schema) {
      const [database, table] = tableParts(schema.table);
      return database
        ? db`SELECT column_name, column_type, column_default, is_nullable FROM information_schema.columns WHERE table_schema = ${database} AND table_name = ${table}`
        : db`SELECT column_name, column_type, column_default, is_nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ${table}`;
    },
    async getTableData(db, schema, limit, offset) {
      return db`SELECT * FROM ${tableFragment(schema)} LIMIT ${limit} OFFSET ${offset}`;
    },
    async optimize(db, schema) {
      await db`${sql.unsafe(`OPTIMIZE TABLE ${quoteTable(schema.table)}`)}`;
    },
  };
}

export const mysqlDialect = makeMysqlDialect("mysql");
export const mariadbDialect = makeMysqlDialect("mariadb");
