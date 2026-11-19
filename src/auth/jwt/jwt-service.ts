import { JwtEngine, type JwtPayload } from "./jwt-engine";

/**
 * Persistence contract for refresh tokens.
 *
 * Implement this interface with any database, key-value store, or external
 * persistence service. `consume` must atomically remove a token and return
 * `true` only for the caller that removed it, preventing concurrent reuse.
 */
export interface JwtRefreshTokenStore {
  /** Initialize the backing store or its schema when needed. */
  initialize?(): Promise<void>;

  /** Persist a refresh token until its Unix expiration time in milliseconds. */
  save(token: string, expiresAt: number): Promise<void>;

  /** Atomically remove a stored refresh token and report whether it existed. */
  consume(token: string): Promise<boolean>;
}

export interface JWTConfig {
  /** Refresh token lifetime in days. Defaults to 7. */
  refreshValidity?: number;
  /** Access token lifetime in minutes. Defaults to 15. */
  tokenValidity?: number;
}

/**
 * Signs access tokens and manages one-time refresh tokens through an injected
 * persistence adapter.
 *
 * @typeParam T - Shape of the claims carried by the access and refresh tokens.
 */
export class JWTAuthService<T extends Record<string, any> = {}> {
  public readonly config: Required<JWTConfig>;
  private readonly engine: JwtEngine<T>;

  constructor(
    private readonly refreshTokens: JwtRefreshTokenStore,
    secret: string,
    config: JWTConfig = {},
  ) {
    this.engine = new JwtEngine<T>(secret);
    const { refreshValidity = 7, tokenValidity = 15 } = config;

    if (!Number.isFinite(refreshValidity) || refreshValidity <= 0) {
      throw new RangeError("Refresh token validity must be a positive number of days.");
    }
    if (!Number.isFinite(tokenValidity) || tokenValidity <= 0) {
      throw new RangeError("Access token validity must be a positive number of minutes.");
    }

    this.config = { refreshValidity, tokenValidity };
  }

  /** Initialize the configured persistence adapter, if it needs initialization. */
  public async init(): Promise<void> {
    await this.refreshTokens.initialize?.();
  }

  /** Sign an access token using the configured access-token lifetime. */
  public sign(payload: T): string {
    return this.engine.sign(payload, this.config.tokenValidity);
  }

  /** Verify an access token and return its claims, or `null` if invalid. */
  public verify(token: string): JwtPayload<T> | null {
    return this.engine.verify(token);
  }

  /**
   * Atomically consume a valid, stored refresh token.
   *
   * @returns The token claims when consumption succeeds; otherwise `null`.
   */
  public async consume(token: string): Promise<JwtPayload<T> | null> {
    const payload = this.engine.verify(token);
    if (!payload) return null;

    const consumed = await this.refreshTokens.consume(token);
    return consumed ? payload : null;
  }

  /** Issue a refresh token, persist it, and return it with a new access token. */
  public async issue(payload: T): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    const refreshToken = this.engine.issue(payload, this.config.refreshValidity);
    const expiresAt = Date.now() + this.config.refreshValidity * 24 * 60 * 60 * 1000;
    await this.refreshTokens.save(refreshToken, expiresAt);

    return {
      accessToken: this.sign(payload),
      refreshToken,
    };
  }
}
