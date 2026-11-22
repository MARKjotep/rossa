import { describe, expect, it } from "bun:test";
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { z, SchemaError, Schema } from "../../src/schema";
import {
  DbSchema as RootDbSchema,
  Schema as RootSchema,
  SchemaError as RootSchemaError,
  z as rootZ,
} from "../../src/index";

describe("schema", () => {
  it("infers output types and parses a nested object", () => {
    const UserSchema = z.object({
      name: z.string().min(1).max(64),
      email: z.string().email(),
      age: z.coerce.number().int().min(0).optional(),
      role: z.string().default("user"),
      tags: z.array(z.string()).min(1).optional(),
      address: z.object({ city: z.string() }),
      active: z.coerce.boolean().default(false),
    });

    type User = z.infer<typeof UserSchema>;

    const parsed: User = UserSchema.parse({
      name: "Ada",
      email: "ada@example.com",
      address: { city: "Paris" },
      extra: "stripped",
    });

    // tsc enforces these assignments, so inference cannot silently become any.
    const name: string = parsed.name;
    const age: number | undefined = parsed.age;
    const role: string = parsed.role;
    const active: boolean = parsed.active;
    const city: string = parsed.address.city;
    // @ts-expect-error name is a string, not a number.
    const wrong: number = parsed.name;

    expect(name).toBe("Ada");
    expect(age).toBeUndefined();
    expect(role).toBe("user");
    expect(active).toBe(false);
    expect(city).toBe("Paris");
    expect(wrong as unknown).toBe("Ada");

    const explicit: User = {
      name: "Ada",
      email: "ada@example.com",
      role: "admin",
      address: { city: "Paris" },
      active: true,
    };
    expect(explicit.role).toBe("admin");
  });

  it("reports safeParse failures and lets parse throw SchemaError", () => {
    const schema = z.object({
      name: z.string().min(1),
      age: z.number().int(),
    });

    const success = schema.safeParse({ name: "Ada", age: 36 });
    expect(success.success).toBe(true);
    if (success.success) {
      expect(success.data).toEqual({ name: "Ada", age: 36 });
    }

    const failure = schema.safeParse({ name: "", age: 1.5 });
    expect(failure.success).toBe(false);
    if (!failure.success) {
      expect(failure.error).toBeInstanceOf(SchemaError);
      expect(failure.error.name).toBe("SchemaError");
      expect(failure.error.message).toContain("'name'");
      expect(failure.error.issues.map((issue) => issue.path)).toEqual([
        ["name"],
        ["age"],
      ]);
    }

    expect(() => schema.parse({ name: "Ada" })).toThrow(SchemaError);

    try {
      schema.parse({ name: 42, age: 1 });
      throw new Error("expected parse to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaError);
      const schemaError = error as SchemaError;
      expect(schemaError.issues).toEqual([
        { path: ["name"], message: "'name' must be a string" },
      ]);
    }
  });

  it("strips unknown object keys", () => {
    const schema = z.object({ a: z.string() });
    expect(schema.parse({ a: "x", extra: 1 })).toEqual({ a: "x" });

    const nested = z.object({
      inner: z.object({ keep: z.number() }),
    });
    expect(nested.parse({ inner: { keep: 1, drop: true } })).toEqual({
      inner: { keep: 1 },
    });
  });

  it("handles optional, nullable, and default modifiers", () => {
    const optional = z.string().optional();
    expect(optional.safeParse(undefined)).toEqual({
      success: true,
      data: undefined,
    });
    expect(optional.safeParse(null).success).toBe(false);

    const nullable = z.string().nullable();
    expect(nullable.safeParse(null)).toEqual({ success: true, data: null });
    expect(nullable.safeParse(undefined).success).toBe(false);

    const both = z.string().optional().nullable();
    expect(both.safeParse(null).success).toBe(true);
    expect(both.safeParse(undefined).success).toBe(true);

    const defaulted = z.string().default("fallback");
    expect(defaulted.safeParse(undefined)).toEqual({
      success: true,
      data: "fallback",
    });
    expect(defaulted.safeParse(null).success).toBe(false);
    expect(defaulted.parse("given")).toBe("given");

    const object = z.object({
      required: z.string(),
      optional: z.string().optional(),
      nullable: z.string().nullable(),
      defaulted: z.string().default("x"),
    });

    expect(object.parse({ required: "a", nullable: null })).toEqual({
      required: "a",
      nullable: null,
      defaulted: "x",
    });
  });

  it("never mutates a schema reused in multiple modifier chains", () => {
    const base = z.string();
    const optional = base.optional();

    expect(base.safeParse(undefined).success).toBe(false);
    expect(optional.safeParse(undefined).success).toBe(true);

    const secondBase = z.string();
    const min = secondBase.min(5);
    const max = secondBase.max(1);

    expect(min.safeParse("abc").success).toBe(false);
    expect(max.safeParse("a").success).toBe(true);
    expect(secondBase.safeParse("abc").success).toBe(true);
  });

  it("coerces query/form strings before validation", () => {
    expect(z.coerce.number().parse("42")).toBe(42);
    expect(z.coerce.number().parse("  -3.5  ")).toBe(-3.5);
    expect(z.coerce.number().safeParse("").success).toBe(false);
    expect(z.coerce.number().safeParse("   ").success).toBe(false);
    expect(z.coerce.number().safeParse("zero").success).toBe(false);
    expect(z.coerce.number().parse(7)).toBe(7);

    expect(z.coerce.boolean().parse("true")).toBe(true);
    expect(z.coerce.boolean().parse("TRUE")).toBe(true);
    expect(z.coerce.boolean().parse("1")).toBe(true);
    expect(z.coerce.boolean().parse("false")).toBe(false);
    expect(z.coerce.boolean().parse("FALSE")).toBe(false);
    expect(z.coerce.boolean().parse("0")).toBe(false);
    expect(z.coerce.boolean().safeParse("yes").success).toBe(false);
    expect(z.coerce.boolean().parse(true)).toBe(true);

    expect(z.coerce.string().parse(42)).toBe("42");
    expect(z.coerce.string().parse(true)).toBe("true");
  });

  it("reports string, number, and array rule failures", () => {
    expect(z.string().min(2).safeParse("a").success).toBe(false);
    expect(z.string().max(2).safeParse("abc").success).toBe(false);
    expect(z.string().email().safeParse("a@exampleXcom").success).toBe(false);
    expect(z.string().email().safeParse("a@example.com").success).toBe(true);

    expect(z.number().min(1).safeParse(0).success).toBe(false);
    expect(z.number().max(1).safeParse(2).success).toBe(false);
    expect(z.number().int().safeParse(1.5).success).toBe(false);
    expect(z.number().int().safeParse(2).success).toBe(true);

    expect(z.array(z.string()).min(1).safeParse([]).success).toBe(false);
    expect(z.array(z.string()).max(1).safeParse(["a", "b"]).success).toBe(
      false,
    );
  });

  it("collects type mismatches instead of throwing", () => {
    // The old builder threw when rules met boolean values; parsing now reports
    // an issue and leaves the schema usable.
    const schema = z.number().min(1);
    const result = schema.safeParse(true);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([]);
      expect(result.error.issues[0]?.message).toContain("must be a number");
    }
    expect(schema.parse(2)).toBe(2);
  });

  it("reports nested object and array paths", () => {
    const schema = z.object({
      address: z.object({ city: z.string() }),
      tags: z.array(z.string().min(2)),
    });

    const result = schema.safeParse({
      address: { city: 42 },
      tags: ["ok", "x"],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toEqual([
        ["address", "city"],
        ["tags", 1],
      ]);
    }
  });

  it("validates arrays of objects with indexed paths", () => {
    const schema = z.array(z.object({ id: z.number().int() }));

    expect(schema.parse([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);

    const result = schema.safeParse([{ id: 1 }, { id: "two" }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        { path: [1, "id"], message: "'[1].id' must be a number" },
      ]);
    }
  });

  it("reports missing required fields with a readable message", () => {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        { path: ["name"], message: "'name' is required" },
      ]);
      expect(result.error.message).toBe("'name' is required");
    }
  });

  it("exposes the Standard Schema validate contract", () => {
    const schema = z.object({
      name: z.string().trim(),
      age: z.coerce.number().int(),
      role: z.string().default("user"),
    });

    expect(
      schema["~standard"].validate({ name: " Ada ", age: "36", extra: true }),
    ).toEqual({ value: { name: "Ada", age: 36, role: "user" } });

    const failure = schema["~standard"].validate({ name: 42, age: "nope" });
    expect(failure).toEqual({
      issues: [
        { message: "'name' must be a string", path: ["name"] },
        { message: "'age' must be a number", path: ["age"] },
      ],
    });
    expect("value" in failure).toBe(false);
  });

  it("binds Standard Schema to each clone independently", () => {
    const base = z.string();
    const optional = base.optional();

    expect(base["~standard"]).not.toBe(optional["~standard"]);
    expect(base["~standard"].validate(undefined)).toEqual({
      issues: [{ message: "value is required", path: [] }],
    });
    expect(optional["~standard"].validate(undefined)).toEqual({
      value: undefined,
    });
  });

  it("generates JSON Schema for primitives and modifiers", () => {
    expect(z.string().toJSONSchema()).toEqual({ type: "string" });
    expect(z.string().min(2).max(5).toJSONSchema()).toEqual({
      type: "string",
      minLength: 2,
      maxLength: 5,
    });
    expect(z.string().email().toJSONSchema()).toEqual({
      type: "string",
      format: "email",
    });
    expect(z.number().toJSONSchema()).toEqual({ type: "number" });
    expect(z.number().int().min(0).max(10).toJSONSchema()).toEqual({
      type: "integer",
      minimum: 0,
      maximum: 10,
    });
    expect(z.boolean().toJSONSchema()).toEqual({ type: "boolean" });
    expect(z.string().nullable().toJSONSchema()).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    });
    expect(z.string().default("x").toJSONSchema()).toEqual({
      type: "string",
      default: "x",
    });
  });

  it("generates JSON Schema for arrays and objects", () => {
    expect(z.array(z.string()).min(1).max(3).toJSONSchema()).toEqual({
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 3,
    });

    const object = z.object({
      name: z.string(),
      nickname: z.string().optional(),
      role: z.string().default("user"),
      age: z.number().nullable(),
    });

    expect(object.toJSONSchema()).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        nickname: { type: "string" },
        role: { type: "string", default: "user" },
        age: { anyOf: [{ type: "number" }, { type: "null" }] },
      },
      required: ["name", "age"],
      additionalProperties: false,
    });

    expect(z.object({}).toJSONSchema()).toEqual({
      type: "object",
      additionalProperties: false,
    });
  });

  it("trims strings before rules and in the output", () => {
    expect(z.string().trim().parse("  hello  ")).toBe("hello");
    expect(z.string().trim().min(2).parse("  ab  ")).toBe("ab");
    expect(z.string().trim().min(2).safeParse("  a  ").success).toBe(false);
    expect(z.string().trim().max(2).safeParse("  abc  ").success).toBe(false);
    expect(z.string().trim().email().parse(" ada@example.com ")).toBe(
      "ada@example.com",
    );
    expect(z.coerce.string().trim().parse(42)).toBe("42");
  });

  it("is assignable to the MCP SDK StandardSchemaWithJSON interface", () => {
    const concrete = z.object({ text: z.string() });
    const schema: StandardSchemaWithJSON = concrete;
    type Args = StandardSchemaWithJSON.InferOutput<typeof concrete>;

    const args: Args = { text: "hello" };
    const text: string = args.text;
    expect(text).toBe("hello");

    expect(schema["~standard"].validate({ text: "hello" })).toEqual({
      value: { text: "hello" },
    });
    expect(schema["~standard"].validate({})).toEqual({
      issues: [{ message: "'text' is required", path: ["text"] }],
    });
    expect(schema["~standard"].jsonSchema.input({ target: "draft-07" })).toEqual(
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    );
  });

  it("exports the validation Schema and DbSchema from the package root", () => {
    const validation: RootSchema<string> = z.string();
    expect(validation.parse("x")).toBe("x");

    expect(RootSchema).toBe(Schema);
    expect(RootSchemaError).toBe(SchemaError);
    expect(rootZ.string).toBe(z.string);
    expect(RootDbSchema.name).toBe("DbSchema");
  });
});
