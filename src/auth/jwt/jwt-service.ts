import { JwtEngine, type JwtPayload } from "./jwt-engine";

/**
 * Why a refresh token was rejected.
 *
 * - `invalid` — missing, malformed, or forged token (bad signature/shape).
 * - `expired` — validly signed token whose `exp` has passed.
 * - `reused` — valid, unexpired token that the store no longer considers
 *   available (already consumed or otherwise claimed).
 */
export type RefreshRejectionReason = "invalid" | "expired" | "reused";

/** Result of a refresh-token consumption attempt. */
export type RefreshConsumeResult<T extends Record<string, any> = {}> =
  | { ok: true; claims: JwtPayload<T> }
  | { ok: false; reason: RefreshRejectionReason };

/**
 * Persistence contract for refresh tokens.
 *
 * Implement this interface with any database, key-value store, or external
 * persistence service. `consume` must atomically *claim* a token and return
 * `true` only for the caller that claimed it, preventing concurrent reuse.
 *
 * Claim-once does not require deleting the row: a store may keep the row and
 * stamp `consumed_at`, returning `false` on every later attempt. Keeping the
 * audit trail is therefore allowed; only the boolean contract matters.
 */
export interface JwtRefreshTokenStore {
  /** Initialize the backing store or its schema when needed. */
  initialize?(): Promise<void>;

  /** Persist a refresh token until its Unix expiration time in milliseconds. */
  save(token: string, expiresAt: number): Promise<void>;

  /**
   * Atomically claim a stored refresh token and report whether this caller
   * won. May delete the row or mark it consumed; later calls must return
   * `false`.
   */
  consume(token: string): Promise<boolean>;

  /**
   * Optional maintenance hook: remove rows that expired before `before`
   * (Unix milliseconds). Implementations without it keep working; callers
   * should treat a missing hook as a no-op.
   *
   * @returns The number of removed rows, when the store reports it.
   */
  deleteExpired?(before: number): Promise<number | void>;
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

  /**
   * Sign an access token.
   *
   * @param payload - Claims to embed.
   * @param lifetimeSeconds - Optional per-call lifetime in seconds. When
   * omitted, the service's minute-based `tokenValidity` is used.
   */
  public sign(payload: T, lifetimeSeconds?: number): string {
    if (lifetimeSeconds === undefined) {
      return this.engine.sign(payload, this.config.tokenValidity);
    }

    return this.engine.signSeconds(payload, lifetimeSeconds);
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
    const result = await this.consumeWithReason(token);
    return result.ok ? result.claims : null;
  }

  /**
   * Atomically consume a refresh token and report why it was rejected.
   *
   * Expired, malformed, and already-claimed tokens are distinguished without
   * changing {@link JWTAuthService.consume}'s existing claims/`null` result.
   */
  public async consumeWithReason(
    token: string,
  ): Promise<RefreshConsumeResult<T>> {
    const inspection = this.engine.inspect(token);

    if (!inspection.ok) {
      return { ok: false, reason: inspection.reason };
    }

    const consumed = await this.refreshTokens.consume(token);
    if (!consumed) return { ok: false, reason: "reused" };

    return { ok: true, claims: inspection.payload };
  }

  /**
   * Remove refresh-token rows that expired before `before` when the store
   * implements the optional cleanup hook. Stores without it are a no-op.
   *
   * @param before - Unix milliseconds cutoff (defaults to now).
   */
  public async deleteExpired(before: number = Date.now()): Promise<number | void> {
    return this.refreshTokens.deleteExpired?.(before);
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
