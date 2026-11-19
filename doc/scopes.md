# Shared scopes

`Scope` provides named, typed values anywhere in your application. Its
properties are ordinary values and functions. Use `Field` for decorators.

```ts
import { Scope } from "rossa";

const settings = Scope.register({
  app: {
    name: "Rossa",
    greet: (name: string) => `Hello, ${name}!`,
  },
}).use("app");

function greeting() {
  return settings.greet(settings.name);
}

// Access an already registered scope from another module.
const app = Scope.use<typeof settings>("app");
```

Register a scope before calling `use()`. An unknown name throws an error.
Registration stores a sealed shallow copy: existing properties can change,
and callers share those changes, but properties cannot be added or removed.
Registering the same name again replaces its stored object; existing references
still point to the earlier object.

`Scope` and `Field` have separate registries. These values are shared across
the application; use request context for values that differ per request.
