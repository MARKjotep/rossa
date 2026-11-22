import type { SQL } from "bun";
import type { DbSchema } from "./schema";
import { getDialect } from "./dialects/registry";

/** Shared inspection API; SQL-specific operations live in the dialect adapter. */
export class DbInspector<T extends Record<string, any>> {
  constructor(
    private readonly db: SQL,
    public readonly schema: DbSchema<T>,
  ) {}

  listTables(): Promise<string[]> {
    return this.schema.dialect.listTables(this.db);
  }

  dropTable(): Promise<void> {
    return this.schema.dialect.dropTable(this.db, this.schema);
  }

  truncateTable(): Promise<void> {
    return this.schema.dialect.truncateTable(this.db, this.schema);
  }

  getTableStats() {
    return this.schema.dialect.getTableStats(this.db, this.schema);
  }

  getTableIndices(): Promise<any[]> {
    return this.schema.dialect.getTableIndices(this.db, this.schema);
  }

  getTableSchema(): Promise<any[]> {
    return this.schema.dialect.getTableSchema(this.db, this.schema);
  }

  getTableData(limit = 50, offset = 0): Promise<any[]> {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError("Limit must be a non-negative safe integer.");
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError("Offset must be a non-negative safe integer.");
    }
    return this.schema.dialect.getTableData(this.db, this.schema, limit, offset);
  }

  optimize(): Promise<void> {
    return this.schema.dialect.optimize(this.db, this.schema);
  }

  static sqlite<T extends Record<string, any>>(db: SQL, schema: DbSchema<T>) {
    return new DbInspector(db, schema.withDialect(getDialect("sqlite")));
  }

  static postgres<T extends Record<string, any>>(db: SQL, schema: DbSchema<T>) {
    return new DbInspector(db, schema.withDialect(getDialect("postgres")));
  }
}
