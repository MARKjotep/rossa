import type { SQL } from "bun";
import type { Column } from "../column";
import type { Schema } from "../schema";

export type DbDialectName = "sqlite" | "postgres" | "mysql" | "mariadb";

export interface TableStats {
  rowCount: number;
  diskSize: string;
  indexCount: number;
}

/** Operations whose SQL differs between database engines. */
export interface DbDialectAdapter {
  readonly name: DbDialectName;
  quoteIdentifier(name: string): string;
  quoteTable(name: string): string;
  normalizeColumnName(name: string): string;
  buildColumn(name: string, column: Column): string;
  buildColumnType(column: Column): string;
  normalizeOperator(operator: string): string;
  version(db: SQL): Promise<string>;
  createTable(db: SQL, schema: Schema<any>): Promise<void>;
  getColumns(db: SQL, schema: Schema<any>): Promise<string[]>;
  addColumn(db: SQL, schema: Schema<any>, name: string, type: string): Promise<void>;
  dropColumn(db: SQL, schema: Schema<any>, name: string): Promise<void>;
  upsert<T extends Record<string, any>>(
    db: SQL,
    schema: Schema<T>,
    data: T,
    conflictColumn: keyof T,
  ): Promise<T | undefined>;
  listTables(db: SQL): Promise<string[]>;
  dropTable(db: SQL, schema: Schema<any>): Promise<void>;
  truncateTable(db: SQL, schema: Schema<any>): Promise<void>;
  getTableStats(db: SQL, schema: Schema<any>): Promise<TableStats>;
  getTableIndices(db: SQL, schema: Schema<any>): Promise<any[]>;
  getTableSchema(db: SQL, schema: Schema<any>): Promise<any[]>;
  getTableData(db: SQL, schema: Schema<any>, limit: number, offset: number): Promise<any[]>;
  optimize(db: SQL, schema: Schema<any>): Promise<void>;
}
