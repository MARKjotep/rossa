# JWT authentication

`JWTAuthService` signs and verifies JWTs without depending on a particular
database library. Supply a `JwtRefreshTokenStore` implementation for the
database, key-value store, or other persistence system used by your app.

## Implement a refresh-token store

```ts
import type { JwtRefreshTokenStore } from "./jwt-service";

export const refreshTokenStore: JwtRefreshTokenStore = {
  async initialize() {
    // Create a table, collection, or keyspace if your app needs it.
  },

  async save(token, expiresAt) {
    // Store the token with its expiration time.
  },

  async consume(token) {
    // Atomically remove the token. Return true only if it existed and
    // this call removed it; concurrent calls must not both return true.
    return false;
  },
};
```

Use your database's atomic delete/returning operation, a transaction, or an
equivalent compare-and-delete operation for `consume`. The service validates
the token signature and expiry before asking the store to consume it. Store
implementations should also expire old entries using the provided Unix
timestamp in milliseconds.

## Create the service

```ts
import { JWTAuthService } from "./jwt-service";
import { refreshTokenStore } from "./refresh-token-store";

interface Claims {
  userId: string;
  role: string;
}

const jwt = new JWTAuthService<Claims>(
  refreshTokenStore,
  process.env.JWT_SECRET!,
  {
    tokenValidity: 15, // minutes
    refreshValidity: 7, // days
  },
);

await jwt.init(); // Calls store.initialize when provided.
const tokens = await jwt.issue({ userId: "user-123", role: "member" });
```

`issue` persists a refresh token and returns it with an access token.
`consume` validates and atomically consumes a refresh token, returning its
claims only once. `sign` and `verify` handle access tokens without persistence.
