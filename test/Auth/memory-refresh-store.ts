import type { JwtRefreshTokenStore } from "../../src/auth/jwt/jwt-service";

/** Minimal claim-once store: delete-on-read under a single JS thread. */
export class MemoryRefreshStore implements JwtRefreshTokenStore {
  public readonly tokens = new Map<string, number>();
  public readonly deleteCalls: number[] = [];

  public async save(token: string, expiresAt: number): Promise<void> {
    this.tokens.set(token, expiresAt);
  }

  public async consume(token: string): Promise<boolean> {
    const expiresAt = this.tokens.get(token);
    if (expiresAt === undefined) return false;

    this.tokens.delete(token);
    return expiresAt > Date.now();
  }

  public async deleteExpired(before: number): Promise<number> {
    this.deleteCalls.push(before);

    let removed = 0;
    for (const [token, expiresAt] of this.tokens) {
      if (expiresAt < before) {
        this.tokens.delete(token);
        removed += 1;
      }
    }

    return removed;
  }
}

/** A store written against the original contract, without the cleanup hook. */
export class BareRefreshStore implements JwtRefreshTokenStore {
  public readonly tokens = new Set<string>();

  public async save(token: string): Promise<void> {
    this.tokens.add(token);
  }

  public async consume(token: string): Promise<boolean> {
    if (!this.tokens.has(token)) return false;
    this.tokens.delete(token);
    return true;
  }
}
