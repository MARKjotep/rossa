import type { AnySchema, InferSchema } from "./types";
import {
  BooleanSchema,
  NumberSchema,
  StringSchema,
} from "./primitives";
import { ArraySchema, ObjectSchema, type Shape } from "./object";

/** Create a text schema. */
export const string = (): StringSchema => new StringSchema();

/** Create a numeric schema. */
export const number = (): NumberSchema => new NumberSchema();

/** Create a boolean schema. */
export const boolean = (): BooleanSchema => new BooleanSchema();

/** Create an array schema for the given item schema. */
export const array = <Item extends AnySchema>(item: Item): ArraySchema<Item> =>
  new ArraySchema(item);

/** Create an object schema with a fixed shape. */
export const object = <TShape extends Shape>(
  shape: TShape,
): ObjectSchema<TShape> => new ObjectSchema(shape);

/**
 * Coercing variants that convert raw query/form strings before validation.
 * Non-string inputs pass through to the underlying type checks.
 */
export const coerce = {
  /** Create a text schema that stringifies numbers and booleans. */
  string: (): StringSchema => new StringSchema({ coerce: true }),
  /** Create a numeric schema that converts numeric strings with `Number()`. */
  number: (): NumberSchema => new NumberSchema({ coerce: true }),
  /**
   * Create a boolean schema that accepts `"true"`/`"1"` and
   * `"false"`/`"0"` case-insensitively.
   */
  boolean: (): BooleanSchema => new BooleanSchema({ coerce: true }),
};

/**
 * Resolve the output type of a schema.
 *
 * ```ts
 * const User = z.object({ name: z.string() });
 * type User = z.infer<typeof User>; // { name: string }
 * ```
 */
export type infer<S extends AnySchema> = InferSchema<S>;
