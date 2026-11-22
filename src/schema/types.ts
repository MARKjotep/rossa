import type {
  StandardJSONSchemaOptions,
  StandardSchemaProps,
} from "./standard";

/**
 * A single validation problem found while parsing a value.
 *
 * `path` identifies the failing location in nested data (for example
 * `["address", "city"]` or `["tags", 0]`), while `message` is a human-friendly
 * explanation written for API consumers.
 */
export type Issue = {
  path: (string | number)[];
  message: string;
};

/** Result of a successful {@link Schema.safeParse} call. */
export type SafeParseSuccess<T> = { success: true; data: T };

/** Result of a failed {@link Schema.safeParse} call. */
export type SafeParseFailure = { success: false; error: SchemaError };

/** Discriminated union returned by {@link Schema.safeParse}. */
export type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseFailure;

/**
 * Error thrown by {@link Schema.parse} when validation fails.
 *
 * Inspect `issues` for structured, path-aware details, or read `message` for a
 * short joined summary.
 */
export class SchemaError extends Error {
  /** Structured validation problems, in the order they were discovered. */
  readonly issues: Issue[];

  constructor(issues: Issue[]) {
    super(issues.map((issue) => issue.message).join(", "));
    this.name = "SchemaError";
    this.issues = issues;
  }
}

/**
 * Any schema, regardless of its output type. Useful for guard options and for
 * accepting schemas whose exact output is not important.
 */
export type AnySchema = Schema<unknown>;

/** Resolve the output type carried by a schema. */
export type InferSchema<S> = S extends Schema<infer Output> ? Output : never;

/** Internal, cloneable flags shared by every schema. */
export interface SchemaState {
  optional: boolean;
  nullable: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
}

/** Create a fresh set of modifier flags. */
export function initialSchemaState(): SchemaState {
  return {
    optional: false,
    nullable: false,
    hasDefault: false,
    defaultValue: undefined,
  };
}

/** Render a validation path as `'name'` or `'address.city'` style text. */
export function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return "value";

  let rendered = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      rendered += `[${segment}]`;
    } else {
      rendered += rendered === "" ? segment : `.${segment}`;
    }
  }
  return `'${rendered}'`;
}

/**
 * Base class for every schema.
 *
 * It owns the shared modifier flags (`.optional()`, `.nullable()`, `.default()`)
 * and the parse/safeParse entry points. Concrete schemas implement `_clone` and
 * `_validate`. All modifier methods return fresh instances, so a schema value
 * can be safely reused in multiple chains.
 */
export abstract class Schema<Output> {
  /** Phantom output type used by `z.infer`. */
  declare readonly _output: Output;

  /**
   * Standard Schema and Standard JSON Schema interface.
   *
   * This is the vendor-neutral contract used by the MCP SDK's `registerTool`
   * and `registerPrompt`. `validate` runs the same pipeline as
   * {@link Schema.safeParse}; `jsonSchema` advertises the wire shape.
   */
  readonly "~standard": StandardSchemaProps<unknown, Output>;

  protected readonly _state: SchemaState;

  constructor(state: SchemaState = initialSchemaState()) {
    this._state = state;
    this["~standard"] = {
      version: 1,
      vendor: "rossa",
      validate: (value) => {
        const result = this.safeParse(value);
        if (result.success) return { value: result.data };

        return {
          issues: result.error.issues.map((issue) => ({
            message: issue.message,
            path: issue.path,
          })),
        };
      },
      jsonSchema: {
        input: (options) => this.toJSONSchema(options),
        output: (options) => this.toJSONSchema(options),
      },
    };
  }

  /** Create a fresh copy of this schema, including its modifier flags. */
  protected abstract _clone(): this;

  /** Validate a defined, non-null value and return the parsed output. */
  protected abstract _validate(
    value: unknown,
    path: (string | number)[],
    issues: Issue[],
  ): Output | undefined;

  /**
   * Render this schema as JSON Schema.
   *
   * The result uses a subset that is valid for draft-07 and draft-2020-12.
   * Unknown top-level input keys are described with
   * `additionalProperties: false`; the requested target is ignored.
   */
  toJSONSchema(
    options: StandardJSONSchemaOptions = { target: "draft-2020-12" },
  ): Record<string, unknown> {
    return this._jsonSchema(options);
  }

  /**
   * Implement each concrete schema's JSON Schema mapping.
   *
   * @internal
   */
  protected abstract _jsonSchema(
    options: StandardJSONSchemaOptions,
  ): Record<string, unknown>;

  /**
   * Whether the field must appear in an object's `required` list.
   *
   * Fields with `.optional()` or `.default(...)` are not required.
   *
   * @internal
   */
  _isRequired(): boolean {
    return !this._state.optional && !this._state.hasDefault;
  }

  /** Return a copy that also accepts `undefined` (a missing key is allowed). */
  optional(): Schema<Output | undefined> {
    const clone = this._clone();
    clone._state.optional = true;
    return clone as unknown as Schema<Output | undefined>;
  }

  /** Return a copy that also accepts `null`, but still rejects `undefined`. */
  nullable(): Schema<Output | null> {
    const clone = this._clone();
    clone._state.nullable = true;
    return clone as unknown as Schema<Output | null>;
  }

  /**
   * Return a copy that substitutes `value` when the input is `undefined`.
   * The same default reference is used for every parse.
   */
  default(value: Exclude<Output, undefined>): Schema<Exclude<Output, undefined>> {
    const clone = this._clone();
    clone._state.hasDefault = true;
    clone._state.defaultValue = value;
    return clone as unknown as Schema<Exclude<Output, undefined>>;
  }

  /**
   * Shared handling for `undefined`, `null`, and defaults before a concrete
   * schema runs its own type checks.
   *
   * @internal
   */
  _run(
    value: unknown,
    path: (string | number)[],
    issues: Issue[],
  ): Output | undefined {
    if (value === undefined) {
      if (this._state.hasDefault) {
        return this._state.defaultValue as Output;
      }
      if (this._state.optional) return undefined;
      issues.push({ path: [...path], message: `${formatPath(path)} is required` });
      return undefined;
    }

    if (value === null) {
      if (this._state.nullable) return null as Output;
      issues.push({
        path: [...path],
        message: `${formatPath(path)} must not be null`,
      });
      return undefined;
    }

    return this._validate(value, path, issues);
  }

  /**
   * Validate a value without throwing.
   *
   * Unknown object keys are stripped from the returned data. On failure the
   * result contains a {@link SchemaError} with every collected issue.
   */
  safeParse(data: unknown): SafeParseResult<Output> {
    const issues: Issue[] = [];
    const value = this._run(data, [], issues);

    if (issues.length > 0) {
      return { success: false, error: new SchemaError(issues) };
    }

    return { success: true, data: value as Output };
  }

  /**
   * Validate a value and return the parsed output.
   *
   * @throws {SchemaError} When the input does not satisfy this schema.
   */
  parse(data: unknown): Output {
    const result = this.safeParse(data);
    if (!result.success) throw result.error;
    return result.data;
  }
}
