import {
  Schema,
  type AnySchema,
  type InferSchema,
  type Issue,
  type SchemaState,
  formatPath,
} from "./types";
import { arrayJSONSchema, objectJSONSchema } from "./json-schema";
import type { StandardJSONSchemaOptions } from "./standard";

/** A map of field names to schemas. */
export type Shape = Record<string, AnySchema>;

type OptionalShapeKeys<TShape extends Shape> = {
  [K in keyof TShape]: undefined extends InferSchema<TShape[K]> ? K : never;
}[keyof TShape];

/** Output type produced by an object schema, with optional fields preserved. */
export type InferShape<TShape extends Shape> = {
  [K in Exclude<keyof TShape, OptionalShapeKeys<TShape>>]: InferSchema<TShape[K]>;
} & {
  [K in OptionalShapeKeys<TShape>]?: Exclude<
    InferSchema<TShape[K]>,
    undefined
  >;
};

type ArrayRule = { kind: "min"; value: number } | { kind: "max"; value: number };

interface ArrayOptions {
  rules?: ArrayRule[];
  state?: SchemaState;
}

/** Schema for arrays whose items share a single item schema. */
export class ArraySchema<Item extends AnySchema> extends Schema<
  InferSchema<Item>[]
> {
  private readonly _item: Item;
  private readonly _rules: ArrayRule[];

  constructor(item: Item, options: ArrayOptions = {}) {
    super(options.state);
    this._item = item;
    this._rules = options.rules ? [...options.rules] : [];
  }

  protected _clone(): this {
    return new ArraySchema(this._item, {
      rules: this._rules,
      state: { ...this._state },
    }) as this;
  }

  /** Require at least `length` items. */
  min(length: number): this {
    return this._withRule({ kind: "min", value: length });
  }

  /** Require at most `length` items. */
  max(length: number): this {
    return this._withRule({ kind: "max", value: length });
  }

  private _withRule(rule: ArrayRule): this {
    const clone = this._clone() as ArraySchema<Item>;
    clone._rules.push(rule);
    return clone as this;
  }

  protected _jsonSchema(
    options: StandardJSONSchemaOptions,
  ): Record<string, unknown> {
    return arrayJSONSchema(
      this._item.toJSONSchema(options),
      this._rules,
      this._state,
    );
  }

  protected _validate(
    value: unknown,
    path: (string | number)[],
    issues: Issue[],
  ): InferSchema<Item>[] | undefined {
    if (!Array.isArray(value)) {
      issues.push({
        path: [...path],
        message: `${formatPath(path)} must be an array`,
      });
      return undefined;
    }

    for (const rule of this._rules) {
      if (rule.kind === "min" && value.length < rule.value) {
        issues.push({
          path: [...path],
          message: `${formatPath(path)} must have at least ${rule.value} items`,
        });
      }
      if (rule.kind === "max" && value.length > rule.value) {
        issues.push({
          path: [...path],
          message: `${formatPath(path)} must have at most ${rule.value} items`,
        });
      }
    }

    return value.map((item, index) =>
      this._item._run(item, [...path, index], issues),
    ) as InferSchema<Item>[];
  }
}

interface ObjectOptions {
  state?: SchemaState;
}

/**
 * Schema for objects with a fixed shape.
 *
 * Unknown input keys are stripped from the parsed output (zod `.strip()`
 * behavior).
 */
export class ObjectSchema<TShape extends Shape> extends Schema<
  InferShape<TShape>
> {
  /** Field schemas keyed by output property name. */
  readonly shape: TShape;

  constructor(shape: TShape, options: ObjectOptions = {}) {
    super(options.state);
    this.shape = shape;
  }

  protected _clone(): this {
    return new ObjectSchema(this.shape, {
      state: { ...this._state },
    }) as this;
  }

  protected _jsonSchema(
    options: StandardJSONSchemaOptions,
  ): Record<string, unknown> {
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];

    for (const key of Object.keys(this.shape)) {
      const field = this.shape[key];
      if (!field) continue;

      properties[key] = field.toJSONSchema(options);
      if (field._isRequired()) required.push(key);
    }

    return objectJSONSchema(properties, required, this._state);
  }

  protected _validate(
    value: unknown,
    path: (string | number)[],
    issues: Issue[],
  ): InferShape<TShape> | undefined {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      issues.push({
        path: [...path],
        message: `${formatPath(path)} must be an object`,
      });
      return undefined;
    }

    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const key of Object.keys(this.shape)) {
      const field = this.shape[key];
      if (!field) continue;

      const hasKey = Object.hasOwn(input, key);
      const parsed = field._run(
        hasKey ? input[key] : undefined,
        [...path, key],
        issues,
      );

      if (!hasKey && parsed === undefined) continue;
      output[key] = parsed;
    }

    return output as InferShape<TShape>;
  }
}
