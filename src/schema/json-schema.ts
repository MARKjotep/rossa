import type { SchemaState } from "./types";

/**
 * JSON Schema generation for Rossa schemas.
 *
 * The emitted subset is valid for draft-07 and draft-2020-12 (and the common
 * OpenAPI 3.0 keyword set). Rossa schemas do not have a dialect-sensitive
 * representation yet, so the requested target is intentionally ignored.
 */

/** Attach a schema's nullable and default modifiers to a generated node. */
export function withSchemaState(
  node: Record<string, unknown>,
  state: SchemaState,
): Record<string, unknown> {
  let result = node;

  if (state.nullable) {
    result = { anyOf: [result, { type: "null" }] };
  }

  if (state.hasDefault) {
    result = { ...result, default: state.defaultValue };
  }

  return result;
}

type StringRuleView = {
  readonly kind: "min" | "max" | "email" | "trim";
  readonly value?: number | undefined;
};

/** Generate JSON Schema for a {@link StringSchema}. */
export function stringJSONSchema(
  rules: ReadonlyArray<StringRuleView>,
  state: SchemaState,
): Record<string, unknown> {
  let minLength: number | undefined;
  let maxLength: number | undefined;
  let email = false;

  for (const rule of rules) {
    if (rule.kind === "min" && rule.value !== undefined) {
      minLength =
        minLength === undefined ? rule.value : Math.max(minLength, rule.value);
    } else if (rule.kind === "max" && rule.value !== undefined) {
      maxLength =
        maxLength === undefined ? rule.value : Math.min(maxLength, rule.value);
    } else if (rule.kind === "email") {
      email = true;
    }
  }

  const node: Record<string, unknown> = { type: "string" };
  if (minLength !== undefined) node.minLength = minLength;
  if (maxLength !== undefined) node.maxLength = maxLength;
  if (email) node.format = "email";

  return withSchemaState(node, state);
}

type NumberRuleView = {
  readonly kind: "min" | "max" | "int";
  readonly value?: number | undefined;
};

/** Generate JSON Schema for a {@link NumberSchema}. */
export function numberJSONSchema(
  rules: ReadonlyArray<NumberRuleView>,
  state: SchemaState,
): Record<string, unknown> {
  let minimum: number | undefined;
  let maximum: number | undefined;
  let integer = false;

  for (const rule of rules) {
    if (rule.kind === "min" && rule.value !== undefined) {
      minimum =
        minimum === undefined ? rule.value : Math.max(minimum, rule.value);
    } else if (rule.kind === "max" && rule.value !== undefined) {
      maximum =
        maximum === undefined ? rule.value : Math.min(maximum, rule.value);
    } else if (rule.kind === "int") {
      integer = true;
    }
  }

  const node: Record<string, unknown> = {
    type: integer ? "integer" : "number",
  };
  if (minimum !== undefined) node.minimum = minimum;
  if (maximum !== undefined) node.maximum = maximum;

  return withSchemaState(node, state);
}

/** Generate JSON Schema for a {@link BooleanSchema}. */
export function booleanJSONSchema(
  state: SchemaState,
): Record<string, unknown> {
  return withSchemaState({ type: "boolean" }, state);
}

type ArrayRuleView = {
  readonly kind: "min" | "max";
  readonly value?: number | undefined;
};

/** Generate JSON Schema for an {@link ArraySchema}. */
export function arrayJSONSchema(
  items: Record<string, unknown>,
  rules: ReadonlyArray<ArrayRuleView>,
  state: SchemaState,
): Record<string, unknown> {
  let minItems: number | undefined;
  let maxItems: number | undefined;

  for (const rule of rules) {
    if (rule.kind === "min" && rule.value !== undefined) {
      minItems =
        minItems === undefined ? rule.value : Math.max(minItems, rule.value);
    } else if (rule.kind === "max" && rule.value !== undefined) {
      maxItems =
        maxItems === undefined ? rule.value : Math.min(maxItems, rule.value);
    }
  }

  const node: Record<string, unknown> = { type: "array", items };
  if (minItems !== undefined) node.minItems = minItems;
  if (maxItems !== undefined) node.maxItems = maxItems;

  return withSchemaState(node, state);
}

/** Generate JSON Schema for an {@link ObjectSchema}. */
export function objectJSONSchema(
  properties: Record<string, Record<string, unknown>>,
  required: readonly string[],
  state: SchemaState,
): Record<string, unknown> {
  const node: Record<string, unknown> = { type: "object" };

  if (Object.keys(properties).length > 0) {
    node.properties = properties;
    if (required.length > 0) node.required = [...required];
  }

  // Rossa object schemas strip unknown keys; documenting that here keeps the
  // advertised shape honest even though stripping is more permissive than
  // validation.
  node.additionalProperties = false;

  return withSchemaState(node, state);
}
