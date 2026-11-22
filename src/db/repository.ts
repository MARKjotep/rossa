import { sql, type SQL } from "bun";
import type { DbDialectAdapter } from "./dialects/dialect";
import {
  DatabaseError,
  ForeignKeyError,
  UniqueConstraintError,
} from "./errors";
import { DbInspector } from "./inspector";
import { DbSchema } from "./schema";

export type Where<T> = {
  [K in keyof T]?: T[K] | { operator: string; value: unknown };
};

const ALLOWED_OPERATORS = new Set([
  "=",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "LIKE",
  "ILIKE",
  "IS",
  "IS NOT",
  "IN",
  "NOT IN",
]);

/** Shared CRUD repository. Dialect-specific statements are delegated to its adapter. */
export class DbRepository<T extends Record<string, any>> {
  constructor(
    private readonly db: SQL,
    public readonly schema: DbSchema<T>,
  ) {}

  private get dialect(): DbDialectAdapter {
    return this.schema.dialect;
  }

  get inspect(): DbInspector<T> {
    return new DbInspector(this.db, this.schema);
  }

  withContext(context: SQL): DbRepository<T> {
    return new DbRepository(context, this.schema);
  }

  create(): Promise<void> {
    return this.dialect.createTable(this.db, this.schema);
  }

  testConnection(): Promise<string> {
    return this.dialect.version(this.db);
  }

  async syncColumns(allowDrop = false): Promise<void> {
    const actualColumns = await this.dialect.getColumns(this.db, this.schema);
    const actualByName = new Map(
      actualColumns.map((name) => [
        this.dialect.normalizeColumnName(name),
        name,
      ]),
    );
    const desired = this.schema.columnDefinitions();
    const desiredNames = Object.keys(desired);
    const desiredNormalized = new Set(
      desiredNames.map((name) => this.dialect.normalizeColumnName(name)),
    );

    for (const name of desiredNames) {
      if (!actualByName.has(this.dialect.normalizeColumnName(name))) {
        await this.dialect.addColumn(
          this.db,
          this.schema,
          name,
          desired[name]!,
        );
      }
    }

    if (allowDrop) {
      for (const [normalizedName, name] of actualByName) {
        if (!desiredNormalized.has(normalizedName)) {
          await this.dialect.dropColumn(this.db, this.schema, name);
        }
      }
    }
  }

  private identifier(name: string) {
    return sql.unsafe(this.dialect.quoteIdentifier(name));
  }

  private get table() {
    return sql.unsafe(this.dialect.quoteTable(this.schema.table));
  }

  private joinSql(fragments: any[], separator: any) {
    if (fragments.length === 0) return sql``;
    return fragments
      .slice(1)
      .reduce(
        (joined, fragment) => sql`${joined}${separator}${fragment}`,
        fragments[0],
      );
  }

  private buildWhere(where: Where<T> = {}) {
    const fragments = Object.entries(where).map(([key, condition]) => {
      if (
        condition !== null &&
        typeof condition === "object" &&
        "operator" in condition &&
        "value" in condition
      ) {
        const requestedOperator = String(condition.operator).toUpperCase();
        if (!ALLOWED_OPERATORS.has(requestedOperator)) {
          throw new TypeError(`Unsupported SQL operator: ${requestedOperator}`);
        }
        const operator = this.dialect.normalizeOperator(requestedOperator);
        const value = condition.value;

        if (operator === "IN" || operator === "NOT IN") {
          if (!Array.isArray(value)) {
            throw new TypeError(`${operator} requires an array value.`);
          }
          if (value.length === 0)
            return operator === "IN" ? sql`1=0` : sql`1=1`;
          const values = this.joinSql(
            value.map((item) => sql`${item}`),
            sql`, `,
          );
          return sql`${this.identifier(key)} ${sql.unsafe(operator)} (${values})`;
        }

        if (value === null && (operator === "=" || operator === "IS")) {
          return sql`${this.identifier(key)} IS NULL`;
        }
        if (value === null && (operator === "!=" || operator === "IS NOT")) {
          return sql`${this.identifier(key)} IS NOT NULL`;
        }
        return sql`${this.identifier(key)} ${sql.unsafe(operator)} ${value}`;
      }

      return condition === null
        ? sql`${this.identifier(key)} IS NULL`
        : sql`${this.identifier(key)} = ${condition}`;
    });

    return fragments.length ? this.joinSql(fragments, sql` AND `) : sql`1=1`;
  }

  async insert(data: T): Promise<T | undefined> {
    try {
      if (this.dialect.name === "mysql" || this.dialect.name === "mariadb") {
        const result = Object.keys(data).length === 0
          ? await this.db<T[]>`INSERT INTO ${this.table} () VALUES ()`
          : await this.db<T[]>`INSERT INTO ${this.table} ${sql(data)}`;
        const [primaryKey] = this.schema.entries().find(([, column]) => column.primaryKey) ?? [];
        if (!primaryKey) return undefined;
        const suppliedKey = (data as Record<string, any>)[primaryKey];
        const key = suppliedKey ?? result.lastInsertRowid;
        if (key == null || (suppliedKey === undefined && key === 0)) return undefined;
        const [row] = await this.db<T[]>`SELECT * FROM ${this.table} WHERE ${this.identifier(primaryKey)} = ${key} LIMIT 1`;
        return row;
      }
      const [row] =
        Object.keys(data).length === 0
          ? await this.db<
              T[]
            >`INSERT INTO ${this.table} DEFAULT VALUES RETURNING *`
          : await this.db<
              T[]
            >`INSERT INTO ${this.table} ${sql(data)} RETURNING *`;
      return row;
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async upsert(data: T, conflictColumn: keyof T): Promise<T | undefined> {
    try {
      return await this.dialect.upsert(
        this.db,
        this.schema,
        data,
        conflictColumn,
      );
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async find(where: Where<T>): Promise<T | null> {
    const [row] = await this.db<T[]>`
      SELECT * FROM ${this.table} WHERE ${this.buildWhere(where)} LIMIT 1
    `;
    return row ?? null;
  }

  async findAll(where?: Where<T>): Promise<T[]> {
    return where && Object.keys(where).length
      ? await this.db<
          T[]
        >`SELECT * FROM ${this.table} WHERE ${this.buildWhere(where)}`
      : await this.db<T[]>`SELECT * FROM ${this.table}`;
  }

  async count(where?: Where<T>): Promise<number> {
    const [row] =
      where && Object.keys(where).length
        ? await this.db<
            { total: number }[]
          >`SELECT COUNT(*) AS total FROM ${this.table} WHERE ${this.buildWhere(where)}`
        : await this.db<
            { total: number }[]
          >`SELECT COUNT(*) AS total FROM ${this.table}`;
    return Number(row?.total ?? 0);
  }

  async exists(where: Where<T>): Promise<boolean> {
    const [row] = await this.db`
      SELECT 1 FROM ${this.table} WHERE ${this.buildWhere(where)} LIMIT 1
    `;
    return row !== undefined;
  }

  async paginate(page: number, limit: number, where?: Where<T>): Promise<T[]> {
    if (!Number.isSafeInteger(page) || page < 1) {
      throw new RangeError("Page must be a positive safe integer.");
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError("Limit must be a positive safe integer.");
    }
    const offset = (page - 1) * limit;
    if (!Number.isSafeInteger(offset)) {
      throw new RangeError("Pagination offset exceeds the safe integer range.");
    }
    return where && Object.keys(where).length
      ? await this.db<
          T[]
        >`SELECT * FROM ${this.table} WHERE ${this.buildWhere(where)} LIMIT ${limit} OFFSET ${offset}`
      : await this.db<
          T[]
        >`SELECT * FROM ${this.table} LIMIT ${limit} OFFSET ${offset}`;
  }

  async update(where: Where<T>, data: Partial<T>): Promise<T[]> {
    try {
      if (Object.keys(where ?? {}).length === 0) {
        throw new DatabaseError(
          "Refusing to update rows without a WHERE condition.",
        );
      }
      if (Object.keys(data).length === 0) {
        throw new DatabaseError("Refusing to run an UPDATE with no values.");
      }
      if (this.dialect.name === "mysql" || this.dialect.name === "mariadb") {
        return await this.db.begin(async (tx) => {
          const rows = await tx<T[]>`SELECT * FROM ${this.table} WHERE ${this.buildWhere(where)} FOR UPDATE`;
          await tx`UPDATE ${this.table} SET ${sql(data as Record<string, any>)} WHERE ${this.buildWhere(where)}`;
          return rows.map((row) => ({ ...row, ...data }));
        });
      }
      return await this.db<T[]>`
        UPDATE ${this.table} SET ${sql(data as Record<string, any>)}
        WHERE ${this.buildWhere(where)} RETURNING *
      `;
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async delete(where: Where<T>): Promise<T[]> {
    try {
      if (Object.keys(where ?? {}).length === 0) {
        throw new DatabaseError(
          "Refusing to delete rows without a WHERE condition.",
        );
      }
      if (this.dialect.name === "mysql" || this.dialect.name === "mariadb") {
        return await this.db.begin(async (tx) => {
          const rows = await tx<T[]>`SELECT * FROM ${this.table} WHERE ${this.buildWhere(where)} FOR UPDATE`;
          await tx`DELETE FROM ${this.table} WHERE ${this.buildWhere(where)}`;
          return rows;
        });
      }
      return await this.db<T[]>`
        DELETE FROM ${this.table} WHERE ${this.buildWhere(where)} RETURNING *
      `;
    } catch (error) {
      this.handleDbError(error);
    }
  }

  async transaction<R>(
    callback: (repository: DbRepository<T>, tx: SQL) => Promise<R>,
  ): Promise<R> {
    try {
      return await this.db.begin(async (tx) =>
        callback(this.withContext(tx), tx),
      );
    } catch (error) {
      this.handleDbError(error);
    }
  }

  private handleDbError(error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (
      normalized.includes("unique constraint failed") ||
      normalized.includes("duplicate key value violates unique constraint") ||
      normalized.includes("duplicate entry")
    ) {
      throw new UniqueConstraintError(
        `A record with this unique value already exists in ${this.schema.table}.`,
      );
    }
    if (
      normalized.includes("foreign key constraint failed") ||
      normalized.includes("violates foreign key constraint") ||
      normalized.includes("foreign key constraint fails")
    ) {
      throw new ForeignKeyError(
        "Cannot delete or update this record because it is referenced by another table.",
      );
    }
    if (
      normalized.includes("database is locked") ||
      normalized.includes("sqlite_busy")
    ) {
      throw new DatabaseError(
        "The database is busy. Please retry the operation.",
      );
    }
    throw error;
  }
}
