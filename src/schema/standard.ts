/**
 * TypeScript types for the
 * {@link https://standardschema.dev/ | Standard Schema} and
 * Standard JSON Schema interfaces.
 *
 * They mirror the vendor-neutral contracts consumed by the MCP SDK. Keeping
 * local copies avoids a runtime dependency on the SDK from the schema library.
 */

/** A single property key or named path segment in an issue path. */
export type StandardPathSegment = PropertyKey | { readonly key: PropertyKey };

/** One validation problem in the Standard Schema shape. */
export interface StandardIssue {
  /** Human-readable explanation of the failure. */
  readonly message: string;
  /** Location of the failing value inside nested data. */
  readonly path?: ReadonlyArray<StandardPathSegment> | undefined;
}

/** Successful validation result. */
export interface StandardSuccessResult<Output> {
  /** Parsed and normalized output value. */
  readonly value: Output;
  readonly issues?: undefined;
}

/** Failed validation result. */
export interface StandardFailureResult {
  /** Every problem found while validating the input. */
  readonly issues: ReadonlyArray<StandardIssue>;
}

/** Discriminated union returned by `~standard.validate`. */
export type StandardValidateResult<Output> =
  | StandardSuccessResult<Output>
  | StandardFailureResult;

/** Options passed to `~standard.validate`. */
export interface StandardValidateOptions {
  /** Extra options for the producing library; unused by Rossa schemas. */
  readonly libraryOptions?: Record<string, unknown> | undefined;
}

/** JSON Schema dialect requested by a consumer. */
export type StandardJSONSchemaTarget =
  | "draft-2020-12"
  | "draft-07"
  | "openapi-3.0"
  | (object & string);

/** Options passed to the `~standard.jsonSchema` converters. */
export interface StandardJSONSchemaOptions {
  /** Target dialect. Rossa emits the same subset for every target. */
  readonly target?: StandardJSONSchemaTarget | undefined;
  /** Extra options for the producing library; unused by Rossa schemas. */
  readonly libraryOptions?: Record<string, unknown> | undefined;
}

/** Converters that advertise a schema's wire shape as JSON Schema. */
export interface StandardJSONSchemaConverter {
  /** JSON Schema describing accepted input values. */
  readonly input: (
    options: StandardJSONSchemaOptions,
  ) => Record<string, unknown>;
  /** JSON Schema describing produced output values. */
  readonly output: (
    options: StandardJSONSchemaOptions,
  ) => Record<string, unknown>;
}

/** Phantom input/output type pair exposed through `~standard.types`. */
export interface StandardTypes<Input = unknown, Output = Input> {
  readonly input: Input;
  readonly output: Output;
}

/** Properties attached to every schema under the `~standard` key. */
export interface StandardSchemaProps<Input = unknown, Output = Input> {
  readonly version: 1;
  readonly vendor: string;
  readonly types?: StandardTypes<Input, Output> | undefined;
  readonly validate: (
    value: unknown,
    options?: StandardValidateOptions | undefined,
  ) => StandardValidateResult<Output>;
  readonly jsonSchema: StandardJSONSchemaConverter;
}

/** Any value implementing the Standard Schema contract. */
export interface StandardSchema<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaProps<Input, Output>;
}
