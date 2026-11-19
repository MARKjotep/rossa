// src/engines/framework/validators/schema.ts
type Primitive = "string" | "number" | "boolean" | "object";

interface Rule {
  fn: (val: any) => boolean;
  message: string;
}

export class SchemaBuilder<T extends Record<string, any>> {
  private schema: Record<keyof T, Primitive> = {} as any;
  private rules: Record<keyof T, Rule[]> = {} as any;
  private defaults: Partial<T> = {} as any; // Stores default values
  // Update setters to accept an optional defaultValue
  string(key: keyof T, defaultValue?: T[keyof T]) {
    this.schema[key] = "string";
    if (defaultValue !== undefined) this.defaults[key] = defaultValue;
    return this;
  }

  number(key: keyof T, defaultValue?: T[keyof T]) {
    this.schema[key] = "number";
    if (defaultValue !== undefined) this.defaults[key] = defaultValue;
    return this;
  }

  boolean(key: keyof T, defaultValue?: T[keyof T]) {
    this.schema[key] = "boolean";
    if (defaultValue !== undefined) this.defaults[key] = defaultValue;
    return this;
  }

  min(key: keyof T, val: number) {
    this.noKey(key, "min");

    this.addRule(
      key,
      (v) => {
        // If it's a string, check length. If it's a number, check magnitude.

        this.noBool(v, "min");

        const actual = typeof v === "string" ? v.length : v;
        return actual >= val;
      },
      `must have at least ${val} ${typeof val === "number" ? "characters/value" : ""}`,
    );
    return this;
  }

  max(key: keyof T, val: number) {
    this.noKey(key, "max");

    this.addRule(
      key,
      (v) => {
        this.noBool(v, "max");
        const actual = typeof v === "string" ? v.length : v;
        return actual <= val;
      },
      `must have at most ${val} ${typeof val === "number" ? "characters/value" : ""}`,
    );
    return this;
  }

  email(key: keyof T) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    this.addRule(
      key,
      (value) => typeof value === "string" && emailRegex.test(value),
      "must be a valid email",
    );
    return this;
  }

  // Helper to store rules
  private addRule(key: keyof T, fn: (v: any) => boolean, message: string) {
    if (!this.rules[key]) this.rules[key] = [];
    this.rules[key].push({ fn, message });
  }

  private noBool(v: any, tp: string) {
    if (typeof v === "boolean") throw new Error(`Can't use ${tp} with Boolean`);
  }
  private noKey(key: keyof T, tp: string) {
    if (!this.schema[key]) {
      throw new Error(`Can't use ${tp} with missing key: ${String(key)}`);
    }
  }
  // --- Validation Logic ---
  // Replace the validate method in SchemaBuilder with this:

  validate(data: any) {
    if (Array.isArray(data)) {
      const errors: string[] = [];
      const processedData: any[] = [];

      data.forEach((item, index) => {
        const { errors: itemErrors, processedData: itemData } =
          this.validateObject(item);
        itemErrors.forEach((err) => errors.push(`[Item ${index}] ${err}`));
        processedData.push(itemData);
      });

      return { errors, processedData };
    }

    return this.validateObject(data);
  }

  private validateObject(data: any) {
    const errors: string[] = [];
    const processedData = { ...data };

    for (const [key, expectedType] of Object.entries(this.schema)) {
      // 1. If missing, check for default
      if (!(key in processedData)) {
        if (key in this.defaults) {
          processedData[key] = this.defaults[key as keyof T];
        } else {
          errors.push(`Missing field: '${key}'`);
          continue;
        }
      }

      // Validate the primitive type before invoking rules that inspect its value.
      if (typeof processedData[key] !== expectedType) {
        errors.push(
          `Invalid type for '${key}': Expected ${expectedType}, got ${typeof processedData[key]}`,
        );
        continue;
      }

      // 2. Rule Check
      if (this.rules[key]) {
        for (const rule of this.rules[key]) {
          if (!rule.fn(processedData[key])) {
            errors.push(`'${key}' ${rule.message}`);
          }
        }
      }

    }

    return { errors, processedData };
  }
}

export function z<T extends Record<string, any>>() {
  return new SchemaBuilder<T>();
}

export function coerceRawObject<T extends Record<string, any>>(
  rawData: Record<string, any>,
  schemaBuilder: SchemaBuilder<T>,
): Record<string, any> {
  // Access internal schema definitions from SchemaBuilder
  const schemaMap = (schemaBuilder as any).schema as Record<string, string>;
  const coerced: Record<string, any> = { ...rawData };

  for (const [key, expectedType] of Object.entries(schemaMap)) {
    if (!(key in rawData) || rawData[key] === undefined) continue;

    const val = rawData[key];

    if (expectedType === "number" && typeof val === "string") {
      const parsed = Number(val);
      if (Number.isFinite(parsed) && val.trim() !== "") {
        coerced[key] = parsed;
      }
    } else if (expectedType === "boolean" && typeof val === "string") {
      if (val.toLowerCase() === "true" || val === "1") coerced[key] = true;
      if (val.toLowerCase() === "false" || val === "0") coerced[key] = false;
    }
  }

  return coerced;
}
