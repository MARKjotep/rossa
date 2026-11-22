# Request guards

Guards run in the request pipeline and can validate a request, add data to its
context, or wrap the response from later guards and route handlers. A guard
factory takes its options and returns the function used by the router.

## Using guards

Register a guard for the whole application with `app.use`, or use the `@use`
decorator on a controller class or handler method:

```ts
import { contentType, rateLimit, use } from "rossa";

app.use(rateLimit({ max: 60, windowMs: 60_000 }));

@use(contentType("application/json"))
class ApiController {
  // Route handlers
}
```

`app.use` prepends guards to the global pipeline, so a guard registered later
runs earlier. Put wrapper guards such as `errorHandler` and
`security` before the work whose response they should wrap. Use the second
argument to a guard factory to override its default error message, headers, or
redirect where applicable; the HTTP status is set by the guard.

## Creating a custom guard

Use `createGuard<TOptions>()` to define reusable request logic. Its handler
receives `(ctx, next, options, errorConfig)`. The call to `createGuard` returns
a factory; calling that factory with options creates the guard function you
register with `app.use` or `@use`.

This example checks a tenant header against an allowlist and stores the
validated tenant ID on `ctx.data` for downstream guards and handlers:

```ts
import { createGuard, sendError, use } from "rossa";

const requireTenant = createGuard<{ allowedIds: string[] }>(
  async (ctx, next, options, errorConfig) => {
    const tenantId = ctx.req.headers.get("x-tenant-id");
    if (!tenantId || !options.allowedIds.includes(tenantId)) {
      return sendError(errorConfig);
    }

    ctx.data.tenantId = tenantId;
    return await next();
  },
  {
    id: "require-tenant",
    code: 403,
    message: "Tenant is not allowed.",
  },
);

// Register it for the whole application:
app.use(requireTenant({ allowedIds: ["tenant-123"] }));

// Or apply a configured instance to a controller or route method:
@use(requireTenant({ allowedIds: ["tenant-123"] }))
class TenantController {}
```

The second argument to the returned factory can override `message`, `headers`,
or `redirect` for a particular use. Set the status code in the default config
passed to `createGuard`; the per-use override does not change it. Use
`sendError(errorConfig)` when rejecting so the configured status, message, and
headers are applied. Return or await `next()` to continue the pipeline, and
avoid calling it more than once.

## Request data and validation

| Guard | Use | Behavior |
| --- | --- | --- |
| `cookies(name)` | Require a cookie | Continues when the named cookie exists in the request's `Cookie` header; returns 401 when it is missing. The value remains available through `ctx.req.cookies.get(name)`. |
| `multipart()` | Multipart forms | Parses `multipart/form-data` into `ctx.form`; uploaded values remain `File` objects and repeated names become arrays. |
| `urlencoded()` | HTML forms | Parses `application/x-www-form-urlencoded` into `ctx.form`; repeated names become arrays. |
| `json(schema)` | JSON body | For POST, PUT, and PATCH, checks the content type and 1 MiB default size limit, parses and validates JSON, and puts the validated result on `ctx.req._json`. The schema must be a `z.object(...)` schema. |
| `keys(names)` | Required body fields | Parses JSON with `ctx.req.json()`, checks top-level keys, then puts the body on `ctx.body`. It does not validate field types. |
| `validateQuery(schema)` | Query validation | Coerces and validates query values, then stores the result in `ctx.query`. Duplicate query names are reduced to their last value. |
| `validateForm(schema)` | Form validation | Parses and validates form values, then stores the result in `ctx.form`. Duplicate field names are reduced to their last value. |
| `validateUrl(options)` | URL limits and rules | Checks URL/query length, duplicate or disallowed query keys, regex rules, malformed encodings, null bytes, and path traversal patterns. Defaults are 2,048 URL characters and 1,024 query characters. |
| `contentType(rule)` | Content type | Accepts a MIME type, list of MIME types, or a synchronous check function. Parameters such as `charset` are ignored during matching. |

Example schema validation:

```ts
import { json, use, validateQuery, z } from "rossa";

const createUserSchema = z<{ name: string }>().string("name").min("name", 1);
const pageSchema = z<{ page: number }>().number("page", 1).min("page", 1);

@use(json(createUserSchema))
class UserController {}

// For a query route, use @use(validateQuery(pageSchema)).
```

`json(schema)` stores validated data in `ctx.req._json`; `keys(names)` stores it
in `ctx.body`. Choose the guard that matches how the handler reads its data.

## Authentication and access

| Guard | Use | Behavior |
| --- | --- | --- |
| `authBearer(check)` | Custom bearer validation | Reads `Authorization: Bearer <token>` and calls `check(ctx, token)`. The check may be async. |
| `apiKey(check)` | API key validation | Reads `x-api-key` and calls `check(ctx, key)`. |
| `auth(checks)` | Validate several headers | Takes a map of header names to sync or async validators; every listed header must be present and pass. |
| `jwtAuth(service)` | JWT access token | Calls `service.verify(token)` and stores decoded claims in `ctx.jwtData`. |
| `jwtRefresh(service)` | Refresh token | Reads `x-refresh-token`, atomically consumes it, issues a replacement token pair in `ctx.data.jwtTokens`, and stores verified claims in `ctx.jwtData`. |
| `session(service)` | Session lifecycle | Loads the session into `ctx.session`, runs downstream work, and persists or deletes session changes afterward. With no session cookie it creates an anonymous session. |
| `authorize(check)` | Authorization | Runs a sync or async policy callback with `ctx`; returns 403 by default when it denies access. Use after authentication. |
| `csrf(options?)` | CSRF token check | On POST, PUT, PATCH, and DELETE, compares a request header (default `x-csrf-token`) with the `csrf_token` cookie. The application must issue that cookie. |

```ts
import {
  authorize,
  jwtAuth,
  use,
  type JWTAuthService,
} from "rossa";

declare const jwtService: JWTAuthService<{ role: string }>; // initialized by the app

@use(jwtAuth(jwtService), authorize((ctx) => ctx.jwtData.role === "admin"))
class AdminController {}

// @use(session(sessionService))
```

`authorize` only evaluates the callback; it does not establish identity. Make
authentication run first and put role, scope, or ownership checks in the
authorization callback. The session guard creates an anonymous session when
there is no valid session cookie, so check an application identity such as
`ctx.session.userId` explicitly in `authorize` when a route requires login.

## Network and security controls

| Guard | Use | Options and behavior |
| --- | --- | --- |
| `cors(options)` | Cross-origin headers | `origin` accepts `"*"`, a string, a list, or a callback; also supports `allowHeaders`, `exposeHeaders`, `credentials`, and `maxAge`. It rejects a supplied origin when it is not allowed, then continues the pipeline (including for OPTIONS requests). |
| `header(rules)` | Required/custom headers | Accepts one header name, a list of names, or a map of names to synchronous validators. |
| `ipFilter(options)` | IP rules | `whitelist` and `blacklist` accept exact IPv4 addresses, IPv4 wildcard patterns, and IPv4 CIDR ranges. |
| `rateLimit(options?)` | Request rate limiting | In-memory per-process counter keyed by IP, method, and path. Defaults: 100 requests per 60 seconds; can add rate and retry headers. |
| `sanitize(options?)` | Parsed request values | Escapes HTML-sensitive characters in strings in `ctx.query`, `ctx.form`, `ctx.body`, and parsed JSON by default. A custom `sanitizeString` and per-area switches are available. Continue context-aware output encoding when rendering. |
| `security(options?)` | Response security headers | Adds `nosniff`, `DENY`, and `strict-origin-when-cross-origin` by default. CSP and HSTS are opt-in; other headers can be set or disabled with `false`. |
| `csrf(options?)` | Cross-site request forgery | See Authentication and access. |

Example URL/IP/security setup:

```ts
import { ipFilter, security, use, validateUrl } from "rossa";

app.use(security());
app.use(ipFilter({ blacklist: ["203.0.113.7"] }));

@use(validateUrl({ noDuplicates: true, maxQueryLength: 512 }))
class SearchController {}
```

### How `validateUrl()` checks a request

`validateUrl()` runs before the route handler. With no options, it allows URLs
up to 2,048 characters and query strings up to 1,024 characters, and checks for
malformed percent escapes, null bytes, and path traversal. Query allowlists,
denylists, duplicate checks, and value patterns are opt-in.

```ts
app.use(
  validateUrl({
    maxUrlLength: 300,
    maxQueryLength: 120,
    allowedKeys: ["page", "sort"],
    disallowedKeys: ["debug"],
    noDuplicates: true,
    patterns: {
      page: /^\d{1,3}$/,
      sort: /^(name|price)$/,
    },
  }),
);
```

With those rules, these URLs pass the URL guard:

```text
/products?page=2&sort=price
/products?sort=name
```

These requests fail, for the indicated reason:

| URL | Result |
| --- | --- |
| `/products?page=1&page=2` | Rejected because `noDuplicates` is enabled. |
| `/products?page=abc` | Rejected because `page` does not match its regular expression. |
| `/products?sort=recent` | Rejected because `sort` does not match its regular expression. |
| `/products?debug=true` | Rejected because `debug` is not allowlisted; it is also explicitly disallowed. |
| `/products?filter=active` | Rejected because `filter` is not in `allowedKeys`. |
| `/files/../private` | Rejected as path traversal. |
| `/files/%252e%252e/private` | Rejected after repeated decoding reveals `../`. |
| `/search?q=%ZZ` | Rejected as malformed percent-encoding when path sanitization is on. |

`allowedKeys` examines parameter names, and each configured `patterns` rule
checks every value for that name. A pattern does not require its key to be
present; use a separate validation rule if the parameter is mandatory. The
path check decodes the full URL repeatedly, so traversal-like text in a query
value can also be rejected. Set `sanitizePaths: false` to disable only those
decode, null-byte, and traversal checks; URL length and query rules still run.

The guard rejects suspicious requests; it does not rewrite or sanitize them.
It also does not validate route parameter formats, so validate IDs in the
handler or with a route-specific guard.

The IP matcher currently handles IPv4 formats. A matching whitelist entry
allows the request immediately, but a non-matching address is not rejected by
the current implementation unless it also matches the blacklist. The rate
limiter and cache are process-local and do not share state between server
instances.

## Response and pipeline guards

| Guard | Use | Behavior |
| --- | --- | --- |
| `logger(label?)` | Request logging | Logs method, path, timestamp, and an optional label before downstream work. |
| `loggerFN(formatter)` | Custom logging | Calls the formatter after downstream work with `{ ctx, res, timestamp, method, url }`, then logs a truthy return value. |
| `timeout(milliseconds)` | Downstream timeout | Stops waiting after the limit and returns 408 by default. It cannot cancel work already running downstream. |
| `smartCache({ ttlMs })` | In-memory GET cache | Caches cacheable `200` GET responses by full URL, including the query string. Requests with `Authorization`, `Cookie`, or `Range` headers bypass it, as do `no-cache`/`no-store` requests. Responses with `Set-Cookie`, `Content-Range`, `Vary`, private/no-store/no-cache directives, or zero max-age are not stored. The store is per-process, capped at 1,000 entries, and sweeps expired entries; use it only for public responses. |
| `staticFiles(options?)` | Static files | Sends GET and HEAD requests for recognized file paths to a static file server. Without options it is a global mount; use `prefix` and `root` to scope a mount. |
| `errorHandler(options?)` | Error boundary | Catches thrown errors from downstream guards and handlers; returns a generic 500 response unless `onError` is supplied. Place it before the work it should catch. |

```ts
import { errorHandler, staticFiles } from "rossa";

app.use(staticFiles());
app.use(errorHandler({ logErrors: true }));
```

Because `app.use` prepends guards, the last registration runs first. In this
example the error guard wraps static serving and route handling.
The core server also has a final error handler for uncaught pipeline errors.

### Static file mounts

`staticFiles(options?)` accepts:

| Option | Type | Behavior |
| --- | --- | --- |
| `prefix` | `string` | Intercepts only paths under this prefix. The decoded pathname is compared at a path-segment boundary, so `/assets` matches `/assets` and `/assets/app.js` but not `/assetsfoo.png`. Non-matching paths call `next()`, so later guards and routes still run. Omit it to intercept every file-like path. |
| `root` | `string` | Serves this mount from its own directory instead of the app-wide `clientPath`. Relative paths resolve against `process.cwd()`; absolute paths are used as-is. With a `prefix`, the prefix is stripped before the lookup, so `/files/logo.png` maps to `<root>/logo.png`. Without a prefix the full request path is used. |
| `extensions` | `string[]` | Additional extensions recognized by this mount, with or without a leading dot. They add to the built-in list, and the app-wide `fileExtensions` setting still applies. |

Only `GET` and `HEAD` requests are intercepted, and HEAD responses keep the
file headers with an empty body. `prefix` and `root` compose freely, and scoped
mounts keep the full traversal defenses: encoded traversal and symlink escapes
return 403. A bare prefix such as `/files` is not a file-like path, so a
request for it falls through to routes.

A mount without `prefix` intercepts **every** file-like path before route
guards run. Protected files therefore cannot be gated by route guards, and a
route whose path ends in a recognized extension (for example
`/reports/daily.pdf`) is answered by the file server instead of the route. Give
each mount an explicit prefix when it is meant to be scoped.

```ts
import { staticFiles } from "rossa";

// Public assets: a scoped mount that runs before authentication.
app.use(staticFiles({ prefix: "/assets" }));

// Private files: served from their own root, only after authentication.
app.use(staticFiles({ prefix: "/files", root: "./private-files" }));
app.use(authGuard);
```

Because `app.use` prepends, `authGuard` (registered last) runs first, so a
denied request never reaches the `/files` mount. Guard order is the ordering
mechanism: register the authentication guard after the mount it protects. A
global `staticFiles()` with no prefix would run before that guard and serve the
file anyway.

## Schema helper

`rossa` exports a small zod-style `z` API. Build schemas with `z.string()`,
`z.number()`, `z.boolean()`, `z.array(item)`, and `z.object(shape)`, then add
`.min`, `.max`, `.int`, `.email`, `.trim()`, `.optional()`, `.nullable()`, or
`.default(value)`. All modifiers return fresh schemas, so a base schema can be
reused safely. `.trim()` normalizes strings before rules run and in the parsed
output.

```ts
import { json, use, validateQuery, z } from "rossa";

const createUserSchema = z.object({
  name: z.string().min(1).max(64),
  email: z.string().email(),
  role: z.string().default("user"),
});

const pageSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  enabled: z.coerce.boolean().default(false),
});

type CreateUser = z.infer<typeof createUserSchema>;

@use(json(createUserSchema))
class UserController {}

// For a query route, use @use(validateQuery(pageSchema)).
```

`schema.parse(value)` returns parsed data or throws `SchemaError` with
`issues` (`{ path, message }` entries). `schema.safeParse(value)` returns
`{ success: true, data }` or `{ success: false, error }`. Use `z.coerce.*` for
query and form values, which arrive as strings; an empty or non-numeric string
is a validation error rather than `0`. Unknown object keys are stripped from
the parsed output (zod `.strip()` behavior). JSON validation checks parsed
types as provided unless you explicitly use `z.coerce.*`. Every schema also
implements the Standard Schema contract (`~standard`) and exposes
`toJSONSchema()`, so the same values can be handed to tools such as the MCP SDK.
