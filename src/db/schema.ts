import type { Column } from "./column";
import type { DbDialectAdapter } from "./dialects/dialect";

export class Schema<T extends Record<string, any>> {
  constructor(
    public readonly table: string,
    private readonly definitions: Record<keyof T, Column>,
    public readonly dialect: DbDialectAdapter,
  ) {}

  entries(): Array<[string, Column]> {
    return Object.entries(this.definitions) as Array<[string, Column]>;
  }

  withDialect(dialect: DbDialectAdapter): Schema<T> {
    const definitions = Object.fromEntries(this.entries()) as Record<keyof T, Column>;
    return new Schema(this.table, definitions, dialect);
  }

  createSQL(adapter: DbDialectAdapter = this.dialect): string {
    const columns = this.entries();
    if (columns.length === 0) {
      throw new Error(`Cannot create table '${this.table}' without columns.`);
    }
    return `CREATE TABLE IF NOT EXISTS ${adapter.quoteTable(this.table)} (\n${columns
      .map(([name, column]) => adapter.buildColumn(name, column))
      .join(",\n")}\n);`;
  }

  columnDefinitions(adapter: DbDialectAdapter = this.dialect): Record<string, string> {
    return Object.fromEntries(
      this.entries().map(([name, column]) => [
        name,
        adapter.buildColumnType(column),
      ]),
    );
  }

  get columns(): { [K in keyof T]: string } {
    return new Proxy({} as { [K in keyof T]: string }, {
      get: (_target, key) => (typeof key === "string" ? key : undefined),
    });
  }
}
