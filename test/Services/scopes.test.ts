import { describe, expect, it } from "bun:test";
import { Field, Scope } from "../../src/index";

describe("Scope", () => {
  it("provides typed values and callable functions outside decorators", () => {
    const app = Scope.register({
      app: {
        name: "Rossa",
        greet: (name: string) => `Hello, ${name}!`,
      },
    }).use("app");

    const greet = () => app.greet(app.name);
    expect(greet()).toBe("Hello, Rossa!");
    expect(Scope.use<typeof app>("app")).toBe(app);
  });

  it("shares changes while sealing a copy of the registered object", () => {
    const initial = { count: 0 };
    const counter = Scope.register({ counter: initial }).use("counter");
    counter.count += 1;

    expect(Scope.use<typeof initial>("counter").count).toBe(1);
    expect(initial.count).toBe(0);
    expect(Object.isSealed(counter)).toBe(true);
  });

  it("reports unregistered scopes", () => {
    expect(() => Scope.use("missing-scope")).toThrow(
      'Scope "missing-scope" has not been registered.',
    );
  });

  it("keeps field decorators working with their own registry", () => {
    const fields = Field.register({ shared: { name: "Field" } }).use("shared");
    const values = Scope.register({ shared: { name: "Scope" } }).use("shared");

    class Example {
      @fields.name name!: string;
    }

    expect(new Example().name).toBe("Field");
    expect(values.name).toBe("Scope");
  });
});
