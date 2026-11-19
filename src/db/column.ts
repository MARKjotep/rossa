export type ColumnType =
  | "text"
  | "integer"
  | "bigint"
  | "boolean"
  | "json"
  | "timestamp"
  | "serial"
  | "numeric";

/** Logical column definition interpreted by the selected database dialect. */
export class Column {
  primaryKey = false;
  required = false;
  isUnique = false;
  hasDefault = false;
  defaultIsCurrentTimestamp = false;
  defaultValue: string | number | boolean | null = null;

  constructor(
    readonly type: ColumnType,
    readonly precision?: number,
    readonly scale?: number,
  ) {
    if (type === "numeric") {
      const p = precision ?? 10;
      const s = scale ?? 2;
      if (!Number.isInteger(p) || !Number.isInteger(s) || p < 1 || p > 1000 || s < 0 || s > p) {
        throw new RangeError("Numeric precision and scale must satisfy 1 <= p <= 1000 and 0 <= s <= p.");
      }
    }
  }

  get primary(): this {
    this.primaryKey = true;
    return this;
  }

  get notNull(): this {
    this.required = true;
    return this;
  }

  get unique(): this {
    this.isUnique = true;
    return this;
  }

  get defaultNow(): this {
    this.hasDefault = true;
    this.defaultIsCurrentTimestamp = true;
    this.defaultValue = null;
    return this;
  }

  default(value: string | number | boolean): this {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new RangeError("Numeric SQL defaults must be finite.");
    }
    this.hasDefault = true;
    this.defaultIsCurrentTimestamp = false;
    this.defaultValue = value;
    return this;
  }
}

export const t = {
  text: () => new Column("text"),
  int: () => new Column("integer"),
  bigint: () => new Column("bigint"),
  boolean: () => new Column("boolean"),
  json: () => new Column("json"),
  timestamp: () => new Column("timestamp"),
  serial: () => new Column("serial"),
  numeric: (precision = 10, scale = 2) =>
    new Column("numeric", precision, scale),
};
