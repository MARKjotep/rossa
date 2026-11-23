import type { Column } from "./column";
import type { DbDialectAdapter } from "./dialects/dialect";

/** A secondary index declared alongside a table definition. */
export interface DbSchemaIndex {
  readonly name: string;
  readonly columns: string[];
  readonly unique?: boolean;
}

/** Optional `DbSchema` configuration. */
export interface DbSchemaOptions {
  /** Secondary indexes created together with the table. */
  readonly indices?: readonly DbSchemaIndex[];
}

function validateIndices<T extends Record<string, any>>(
  table: string,
  definitions: Record<keyof T, Column>,
  indices: readonly DbSchemaIndex[],
): DbSchemaIndex[] {
  const knownColumns = new Set(Object.keys(definitions));
  const names = new Set<string>();
  return indices.map((index) => {
    if (typeof index.name !== "string" || index.name.trim().length === 0) {
      throw new TypeError("Index names must be non-empty strings.");
    }
    if (names.has(index.name)) {
      throw new TypeError(`Duplicate index name '${index.name}' on '${table}'.`);
    }
    names.add(index.name);

    if (!Array.isArray(index.columns) || index.columns.length === 0) {
      throw new TypeError(
        `Index '${index.name}' on '${table}' must declare at least one column.`,
      );
    }
    for (const column of index.columns) {
      if (typeof column !== "string" || !knownColumns.has(column)) {
        throw new TypeError(
          `Index '${index.name}' references unknown column '${String(column)}' on '${table}'.`,
        );
      }
    }
    if (index.unique !== undefined && typeof index.unique !== "boolean") {
      throw new TypeError(
        `Index '${index.name}' on '${table}' has a non-boolean 'unique' flag.`,
      );
    }

    const copy: { name: string; columns: string[]; unique?: boolean } = {
      name: index.name,
      columns: [...index.columns],
    };
    if (index.unique !== undefined) copy.unique = index.unique;
    return copy;
  });
}

export class DbSchema<T extends Record<string, any>> {
  private readonly indexDefinitions: DbSchemaIndex[];

  constructor(
    public readonly table: string,
    private readonly definitions: Record<keyof T, Column>,
    public readonly dialect: DbDialectAdapter,
    options: DbSchemaOptions = {},
  ) {
    this.indexDefinitions = validateIndices(table, definitions, options.indices ?? []);
  }

  entries(): Array<[string, Column]> {
    return Object.entries(this.definitions) as Array<[string, Column]>;
  }

  /** Secondary indexes declared for this table. */
  get indices(): DbSchemaIndex[] {
    return this.indexDefinitions.map((index) => {
      const copy: { name: string; columns: string[]; unique?: boolean } = {
        name: index.name,
        columns: [...index.columns],
      };
      if (index.unique !== undefined) copy.unique = index.unique;
      return copy;
    });
  }

  withDialect(dialect: DbDialectAdapter): DbSchema<T> {
    const definitions = Object.fromEntries(this.entries()) as Record<keyof T, Column>;
    return new DbSchema(this.table, definitions, dialect, {
      indices: this.indices,
    });
  }

  /** The `CREATE TABLE IF NOT EXISTS` statement for this schema. */
  createTableSQL(adapter: DbDialectAdapter = this.dialect): string {
    const columns = this.entries();
    if (columns.length === 0) {
      throw new Error(`Cannot create table '${this.table}' without columns.`);
    }
    return `CREATE TABLE IF NOT EXISTS ${adapter.quoteTable(this.table)} (\n${columns
      .map(([name, column]) => adapter.buildColumn(name, column))
      .join(",\n")}\n);`;
  }

  /** Idempotent `CREATE INDEX` statements for the declared indexes. */
  createIndexSQLs(adapter: DbDialectAdapter = this.dialect): string[] {
    return this.indexDefinitions.map((index) =>
      adapter.createIndexSQL(this.table, index),
    );
  }

  /** Every DDL statement needed to create the table and its indexes. */
  createStatements(adapter: DbDialectAdapter = this.dialect): string[] {
    return [this.createTableSQL(adapter), ...this.createIndexSQLs(adapter)];
  }

  createSQL(adapter: DbDialectAdapter = this.dialect): string {
    return this.createStatements(adapter).join("\n");
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
