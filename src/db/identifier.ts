/** Quote one identifier for PostgreSQL or SQLite. */
export function quoteIdentifier(value: string): string {
  if (!value || value.includes("\0")) {
    throw new Error("SQL identifiers must be non-empty and cannot contain NUL.");
  }
  return `"${value.replace(/"/g, '""')}"`;
}

/** Quote `table` or `schema.table` without treating user input as SQL. */
export function quoteTable(value: string): string {
  const parts = value.split(".");
  if (parts.length > 2 || parts.some((part) => !part || part.includes("\0"))) {
    throw new Error("Table names must be `table` or `schema.table`.");
  }
  return parts.map(quoteIdentifier).join(".");
}

export function tableParts(value: string): [string | undefined, string] {
  const parts = value.split(".");
  if (parts.length > 2 || parts.some((part) => !part || part.includes("\0"))) {
    throw new Error("Table names must be `table` or `schema.table`.");
  }
  return parts.length === 2 ? [parts[0], parts[1]!] : [undefined, parts[0]!];
}
