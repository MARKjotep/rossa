import {
  Schema,
  type Issue,
  type SchemaState,
  formatPath,
} from "./types";
import {
  booleanJSONSchema,
  numberJSONSchema,
  stringJSONSchema,
} from "./json-schema";
import type { StandardJSONSchemaOptions } from "./standard";

type StringRule =
  | { kind: "min"; value: number }
  | { kind: "max"; value: number }
  | { kind: "email" }
  | { kind: "trim" };

type NumberRule =
  | { kind: "min"; value: number }
  | { kind: "max"; value: number }
  | { kind: "int" };

interface StringOptions {
  coerce?: boolean;
  rules?: StringRule[];
  state?: SchemaState;
}

interface NumberOptions {
  coerce?: boolean;
  rules?: NumberRule[];
  state?: SchemaState;
}

interface BooleanOptions {
  coerce?: boolean;
  state?: SchemaState;
}

/** Schema for text values, with `.min`, `.max`, and `.email` rules. */
export class StringSchema extends Schema<string> {
  private readonly _rules: StringRule[];
  private readonly _coerce: boolean;

  constructor(options: StringOptions = {}) {
    super(options.state);
    this._rules = options.rules ? [...options.rules] : [];
    this._coerce = options.coerce ?? false;
  }

  protected _clone(): this {
    return new StringSchema({
      coerce: this._coerce,
      rules: this._rules,
      state: { ...this._state },
    }) as this;
  }

  /** Require at least `length` characters. */
  min(length: number): this {
    return this._withRule({ kind: "min", value: length });
  }

  /** Require at most `length` characters. */
  max(length: number): this {
    return this._withRule({ kind: "max", value: length });
  }

  /** Require a conventional email address (`local@domain.tld`). */
  email(): this {
    return this._withRule({ kind: "email" });
  }

  /**
   * Trim leading and trailing whitespace before validation.
   *
   * `.min`, `.max`, and `.email` see the trimmed value, and the parsed output
   * is trimmed.
   */
  trim(): this {
    return this._withRule({ kind: "trim" });
  }

  private _withRule(rule: StringRule): this {
    const clone = this._clone() as StringSchema;
    clone._rules.push(rule);
    return clone as this;
  }

  protected _jsonSchema(
    _options: StandardJSONSchemaOptions,
  ): Record<string, unknown> {
    return stringJSONSchema(this._rules, this._state);
  }

  protected _validate(
    value: unknown,
    path: (string | number)[],
    issues: Issue[],
  ): string | undefined {
    let input = value;

    if (this._coerce && typeof input !== "string") {
      if (
        typeof input === "number" ||
        typeof input === "boolean" ||
        typeof input === "bigint"
      ) {
        input = String(input);
      }
    }

    if (typeof input !== "string") {
      issues.push({
        path: [...path],
        message: `${formatPath(path)} must be a string`,
      });
      return undefined;
    }

    const text = this._rules.some((rule) => rule.kind === "trim")
      ? input.trim()
      : input;

    for (const rule of this._rules) {
      if (rule.kind === "min" && text.length < rule.value) {
        issues.push({
          path: [...path],
          message: `${formatPath(path)} must have at least ${rule.value} characters`,
        });
      }
      if (rule.kind === "max" && text.length > rule.value) {
        issues.push({
          path: [...path],
          message: `${formatPath(path)} must have at most ${rule.value} characters`,
        });
      }
      if (rule.kind === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
        issues.push({
          path: [...path],
          message: `${formatPath(path)} must be a valid email`,
        });
      }
    }

    return text;
  }
}

/** Schema for numeric values, with `.min`, `.max`, and `.int` rules. */
export class NumberSchema extends Schema<number> {
  private readonly _rules: NumberRule[];
  private readonly _coerce: boolean;

  constructor(options: NumberOptions = {}) {
    super(options.state);
    this._rules = options.rules ? [...options.rules] : [];
    this._coerce = options.coerce ?? false;
  }

  protected _clone(): this {
    return new NumberSchema({
      coerce: this._coerce,
      rules: this._rules,
      state: { ...this._state },
    }) as this;
  }

  /** Require a value greater than or equal to `minimum`. */
  min(minimum: number): this {
    return this._withRule({ kind: "min", value: minimum });
  }

  /** Require a value less than or equal to `maximum`. */
  max(maximum: number): this {
    return this._withRule({ kind: "max", value: maximum });
  }

  /** Require a whole number. */
  int(): this {
    return this._withRule({ kind: "int" });
  }

  private _withRule(rule: NumberRule): this {
    const clone = this._clone() as NumberSchema;
    clone._rules.push(rule);
    return clone as this;
  }

  protected _jsonSchema(
    _options: StandardJSONSchemaOptions,
  ): Record<string, unknown> {
    return numberJSONSchema(this._rules, this._state);
  }

  protected _validate(
    value: unknown,
    path: (string | number)[],
    issues: Issue[],
  ): number | undefined {
    let input = value;

    if (this._coerce && typeof input === "string") {
      const trimmed = input.trim();
      const parsed = trimmed === "" ? Number.NaN : Number(trimmed);

      if (!Number.isFinite(parsed)) {
        issues.push({
          path: [...path],
          message: `${formatPath(path)} must be a number`,
        });
        return undefined;
      }

      input = parsed;
    }

    if (typeof input !== "number" || !Number.isFinite(input)) {
      issues.push({
        path: [...path],
        message: `${formatPath(path)} must be a number`,
      });
      return undefined;
    }

    for (const rule of this._rules) {
      if (rule.kind === "min" && input < rule.value) {
        issues.push({
          path: [...path],
          message: `${formatPath(path)} must be at least ${rule.value}`,
        });
      }
      if (rule.kind === "max" && input > rule.value) {
        issues.push({
          path: [...path],
          message: `${formatPath(path)} must be at most ${rule.value}`,
        });
      }
      if (rule.kind === "int" && !Number.isInteger(input)) {
        issues.push({
          path: [...path],
          message: `${formatPath(path)} must be an integer`,
        });
      }
    }

    return input;
  }
}

/** Schema for boolean values. */
export class BooleanSchema extends Schema<boolean> {
  private readonly _coerce: boolean;

  constructor(options: BooleanOptions = {}) {
    super(options.state);
    this._coerce = options.coerce ?? false;
  }

  protected _clone(): this {
    return new BooleanSchema({
      coerce: this._coerce,
      state: { ...this._state },
    }) as this;
  }

  protected _jsonSchema(
    _options: StandardJSONSchemaOptions,
  ): Record<string, unknown> {
    return booleanJSONSchema(this._state);
  }

  protected _validate(
    value: unknown,
    path: (string | number)[],
    issues: Issue[],
  ): boolean | undefined {
    let input = value;

    if (this._coerce && typeof input === "string") {
      const normalized = input.toLowerCase();
      if (normalized === "true" || normalized === "1") {
        input = true;
      } else if (normalized === "false" || normalized === "0") {
        input = false;
      } else {
        issues.push({
          path: [...path],
          message: `${formatPath(path)} must be a boolean`,
        });
        return undefined;
      }
    }

    if (typeof input !== "boolean") {
      issues.push({
        path: [...path],
        message: `${formatPath(path)} must be a boolean`,
      });
      return undefined;
    }

    return input;
  }
}
