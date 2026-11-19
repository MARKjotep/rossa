import type { DbDialectAdapter, DbDialectName } from "./dialect";
import { postgresDialect } from "./postgres";
import { sqliteDialect } from "./sqlite";
import { mariadbDialect, mysqlDialect } from "./mysql";

const dialects: Record<DbDialectName, DbDialectAdapter> = {
  sqlite: sqliteDialect,
  postgres: postgresDialect,
  mysql: mysqlDialect,
  mariadb: mariadbDialect,
};

export function getDialect(name: DbDialectName): DbDialectAdapter {
  const adapter = dialects[name];
  if (!adapter) throw new Error(`Unsupported database dialect: ${name}`);
  return adapter;
}
