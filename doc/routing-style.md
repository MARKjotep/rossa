# Routing style

This note describes Rossa's route registration and matching behavior as a
reference for the client framework. The client can use its own HTTP controller
class in place of Rossa's `Methods`; the routing model stays the same.

## Route declarations

Each route belongs to a controller class. `@route(path)` declares an HTTP
route, while `@wss(path)` declares a WebSocket upgrade route. A named path
segment such as `:id` captures one non-empty segment, and the resulting values
are exposed as string params. The optional query string does not participate
in matching, and a trailing slash is accepted.

```ts
@route("/users/:id")
class Users extends ClientHttpController {
  get(ctx: ClientContext) { /* ... */ }
}

@wss("/chat/:room")
class Chat extends ClientWebSocketController {
  open() { /* ... */ }
  message(message: ClientMessage) { /* ... */ }
}
```

`ClientHttpController` and `ClientWebSocketController` above are illustrative:
the client framework supplies its own controller bases.

## Registration model

Registration reads route metadata from each class and creates route records.
For each declared path, prepend the router's optional global `basePath`,
collapse repeated slashes, and remove a trailing slash (except for `/`). Compile
`:name` segments to path captures and keep the parameter names alongside the
compiled matcher.

Keep HTTP and WSS registrations separate. A useful route record contains the
normalized path, compiled matcher, parameter names, and the controller class.
HTTP records also contain method-to-handler entries and the methods available
for that path. WSS records contain the WebSocket controller and its route
guards. Duplicate paths are checked within each transport, so an HTTP route
and a WSS route can share a path.

For HTTP, Rossa instantiates the controller during registration, then binds
each implemented lower-case method (`get`, `post`, `put`, `head`, `delete`,
`patch`, `options`, or `event`) to that instance. For the client framework,
collect handlers from its own HTTP controller class in the same registration
step. The router should not need to know how the base class represents those
handlers.

For WSS, retain the controller class in the route record and instantiate it
for each matched upgrade. This gives each connection its own controller
instance and lifecycle state.

## Dispatch

1. Run global guards before route lookup.
2. Strip the query string and normalize a single trailing slash for lookup.
3. For a WebSocket upgrade, find the first matching WSS path, populate params,
   run that route's guards, then upgrade. Store the new controller instance
   with the socket; invoke `open`, `message`, `drain`, and `close` as the
   connection lifecycle proceeds.
4. For HTTP, find a matching path that implements the requested method, set
   params and method information on the request context, run the route/method
   guard chain, then invoke the bound handler. SSE requests dispatch through
   `event`.

Class and method guards are combined for each HTTP handler. The inherited
`options` handler returns 204 and advertises the methods registered for its
path. WSS route guards run before the upgrade and may pass guard data into the
connection context.

## Client framework checklist

- Keep independent HTTP and WSS route tables and registration entry points.
- Store compiled matchers and parameter names at registration, not per request.
- Build HTTP method entries from the client's controller class and bind them
  to its registration-time instance.
- Create WSS controller instances per successful upgrade.
- Preserve global-before-route guard ordering and transport-specific dispatch.
- Match the first registered route that has both a path and, for HTTP, a
  handler for the requested method.
