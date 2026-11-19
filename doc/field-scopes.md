# Typed field scopes in routes

`Field.register()` creates named, typed value scopes. `scope.use(name)` returns
field decorators that initialize controller properties from that scope.
Because a route controller is constructed when routes are registered, these
values work well for app-level settings shared by the controller.

```ts
import { Field, Methods, Rossa, route, type ctx } from "rossa";

const appFields = Field.register({
  site: {
    name: "Rossa Portfolio",
    version: "1.0.0",
    maintenanceMode: false,
  },
}).use("site");

@route("/about")
class AboutRoute extends Methods {
  @appFields.name readonly siteName!: string;
  @appFields.version readonly version!: string;
  @appFields.maintenanceMode readonly maintenanceMode!: boolean;

  override get({ res }: ctx) {
    return res.json({
      site: this.siteName,
      version: this.version,
      maintenanceMode: this.maintenanceMode,
    });
  }
}

const app = new Rossa();
app.register(AboutRoute);
app.serve({ port: 3000 });
```

Each decorator name must match a property in the registered scope. TypeScript
checks the decorated property against the value's type, so `siteName` above
must be a string and `maintenanceMode` must be a boolean. The route can read
the initialized values through `this`.

Field scopes are shared application configuration. They are not request-local
storage; use `ctx.data`, `ctx.session`, or another request-scoped service for
values that differ by request or user.

## Parameterized routes and other methods

Field values can be used alongside route parameters. The field stays the same
for every request; values such as `id` and `name` come from `ctx.params` for
the current request.

```ts
import { Field, Methods, Rossa, route, type ctx } from "rossa";

const fields = Field.register({
  api: { version: "v1", maxNameLength: 40 },
}).use("api");

@route("/users/:id")
class UserRoute extends Methods {
  @fields.version readonly apiVersion!: string;

  override get({ params, res }: ctx) {
    return res.json({
      api: this.apiVersion,
      userId: params.id,
    });
  }

  override put({ params, req, res }: ctx) {
    return req.json<{ displayName: string }>().then(({ displayName }) =>
      res.json({ userId: params.id, displayName }),
    );
  }

  override delete({ params, res }: ctx) {
    return res.json({ deletedUserId: params.id });
  }
}

@route("/api/:name")
class NamedApiRoute extends Methods {
  @fields.version readonly apiVersion!: string;
  @fields.maxNameLength readonly maxNameLength!: number;

  override post({ params, req, res }: ctx) {
    return req.json<{ value: unknown }>().then(({ value }) =>
      res.status(201).json({
        api: this.apiVersion,
        name: params.name,
        value,
        nameLimit: this.maxNameLength,
      }),
    );
  }
}

const app = new Rossa();
app.register(UserRoute, NamedApiRoute);
app.serve({ port: 3000 });
```

Examples: `GET /users/42` returns `userId: "42"`; `PUT /users/42` reads a
JSON `displayName` and includes the same route id; `DELETE /users/42` returns
the deleted id. `POST /api/reports` reads a JSON `value` and uses `reports` as
`params.name`. Route parameter values are strings, so validate or convert them
before using them as numbers or identifiers.

## Register once, use from separate modules

Register the scopes during application setup. Route modules can then call
`Field.use()` by name wherever they need a scope. Keep the shared shape in a
type module so each call gets the right child-field suggestions.

```ts
// app-fields.ts
import { Field } from "rossa";

export type AppFields = {
  shop: {
    id: number;
    name: string;
  };
  lark: {
    token: string;
  };
};

Field.register<AppFields>({
  shop: { id: 2, name: "Rossa Shop" },
  lark: { token: "example-token" },
});
```

```ts
// routes/shop.route.ts
import { Field, Methods, route, type ctx } from "rossa";
import type { AppFields } from "../app-fields";

const shop = Field.use<AppFields["shop"]>("shop");

@route("/shop/:id")
export class ShopRoute extends Methods {
  @shop.id readonly shopId!: number;
  @shop.name readonly shopName!: string;

  override get({ params, res }: ctx) {
    return res.json({
      configuredShopId: this.shopId,
      configuredShopName: this.shopName,
      requestedId: params.id,
    });
  }
}
```

```ts
// routes/lark.route.ts
import { Field, Methods, route, type ctx } from "rossa";
import type { AppFields } from "../app-fields";

const lark = Field.use<AppFields["lark"]>("lark");

@route("/lark/status")
export class LarkRoute extends Methods {
  @lark.token readonly token!: string;

  override get({ res }: ctx) {
    return res.json({ configured: this.token.length > 0 });
  }
}
```

Import `app-fields.ts` from the application entry point before registering the
route classes. Each route module calls `Field.use()` independently, while the
values come from the scopes already registered during setup.

## Share a function through a field scope

A scope can hold functions as well as strings, numbers, and booleans. This
example shares a formatter with a route and passes the request's route
parameter to it:

```ts
import { Field, Methods, Rossa, route, type ctx } from "rossa";

const helpers = Field.register({
  text: {
    greeting: (name: string) => `Hello, ${name}!`,
  },
}).use("text");

@route("/hello/:name")
class GreetingRoute extends Methods {
  @helpers.greeting readonly greeting!: (name: string) => string;

  override get({ params, res }: ctx) {
    return res.text(this.greeting(params.name));
  }
}

const app = new Rossa();
app.register(GreetingRoute);
app.serve({ port: 3000 });
```

`GET /hello/Rossa` responds with `Hello, Rossa!`. Keep request-specific
arguments in the function call; the function stored in the scope is shared
configuration, not per-request state.
