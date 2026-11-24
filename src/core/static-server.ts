import { isAbsolute, relative, resolve, sep } from "path";
import { realpath, stat } from "node:fs/promises";
import type { Req } from "../http/req";
import type { Res } from "../http/res";

interface CachedFile {
  buffer: Uint8Array;
  contentType: string;
  etag: string;
  expiresAt: number; // UNIX epoch timestamp when this block goes stale
  mtimeMs: number; // modification time captured when the entry was filled
  size: number; // byte length captured when the entry was filled
}

/** Options accepted by {@link StaticFileServer}. */
export interface StaticFileServerOptions {
  /**
   * Development mode: disables the ≤ 50 KB in-memory cache so an edited asset
   * is visible on the next request. Files above the threshold already bypass
   * the cache, so the flag has no effect on them.
   */
  dev?: boolean;
}

const fileCache: Map<string, CachedFile> = new Map();
const MAX_CACHE_ENTRIES = 1000;

/** Keeps the shared small-file cache bounded by evicting expired/oldest entries. */
function ensureCacheCapacity(now: number): void {
  if (fileCache.size < MAX_CACHE_ENTRIES) return;

  for (const [key, entry] of fileCache) {
    if (entry.expiresAt <= now) fileCache.delete(key);
  }

  while (fileCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = fileCache.keys().next().value;
    if (oldestKey === undefined) break;
    fileCache.delete(oldestKey);
  }
}

/**
 * Returns the opaque part of an entity-tag: the `W/` weakness indicator is
 * dropped and surrounding whitespace trimmed. Weak comparison (RFC 9110
 * §8.8.3.2) compares exactly this part, so `W/"v1"` and `"v1"` are equal.
 */
function opaqueTag(tag: string): string {
  const trimmed = tag.trim();
  return trimmed.startsWith("W/") ? trimmed.slice(2).trim() : trimmed;
}

/**
 * Evaluates an `If-None-Match` field value against the current
 * representation's entity-tag (RFC 9110 §13.1.2): `*` matches any current
 * representation, and a comma-separated list matches when any member
 * weak-matches the current tag. Empty list members are ignored.
 */
function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (!header) return false;

  const field = header.trim();
  if (field === "*") return true;

  const current = opaqueTag(etag);
  for (const candidate of field.split(",")) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (opaqueTag(trimmed) === current) return true;
  }
  return false;
}

/**
 * Merges `value` into an existing `Vary` field value without duplicating
 * members or overriding a wildcard.
 */
function appendVary(existing: string | undefined, value: string): string {
  if (!existing || !existing.trim()) return value;
  if (existing.trim() === "*") return existing;

  const values = existing
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!values.some((item) => item.toLowerCase() === value.toLowerCase())) {
    values.push(value);
  }
  return values.join(", ");
}

export const DEFAULT_FILE_EXTENSIONS = new Set([
  // Web/Markup
  ".js",
  ".css",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".tsx",
  ".xml",
  ".xhtml",
  // Image
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".tiff",
  ".svg",
  // Documents
  ".txt",
  // files
  ".ico",
  ".woff",
  ".woff2",
  ".json",
]);

function normalizeExtension(extension: string): string {
  const trimmed = extension.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

export function isFile(
  _path: string,
  additionalExtensions: ReadonlySet<string> = new Set(),
) {
  const filename = _path.slice(_path.lastIndexOf("/") + 1).toLowerCase();
  const accepted = [...DEFAULT_FILE_EXTENSIONS, ...additionalExtensions]
    .map(normalizeExtension)
    .filter(Boolean);
  return accepted.some((extension) => filename.endsWith(extension));
}

export class StaticFileServer {
  private readonly absoluteClientPath: string;
  private readonly additionalExtensions: ReadonlySet<string>;
  private readonly dev: boolean;
  private readonly SMALL_FILE_THRESHOLD = 50 * 1024; // 50 KB
  private readonly CACHE_TTL = 15 * 60 * 1000; // 15 Minutes in milliseconds

  constructor(
    resolvedAssetRootPath: string,
    additionalExtensions: string[] = [],
    options: StaticFileServerOptions = {},
  ) {
    this.absoluteClientPath = resolve(resolvedAssetRootPath);
    this.additionalExtensions = new Set(
      additionalExtensions.map(normalizeExtension).filter(Boolean),
    );
    this.dev = options.dev === true;
  }

  isFile(path: string): boolean {
    return isFile(path, this.additionalExtensions);
  }

  /**
   * Builds the cache validator headers shared by every served file and reports
   * whether the client's `If-None-Match` already matches `etag` under RFC 9110
   * weak comparison (wildcard and comma-separated lists included).
   */
  private validators(
    req: Req,
    etag: string,
    mtimeMs?: number,
  ): { headers: Record<string, string>; notModified: boolean } {
    const headers: Record<string, string> = {
      ETag: etag,
      "Cache-Control": `public, max-age=${this.CACHE_TTL / 1000}, must-revalidate`,
    };
    if (mtimeMs !== undefined) {
      headers["Last-Modified"] = new Date(mtimeMs).toUTCString();
    }
    return {
      headers,
      notModified: matchesIfNoneMatch(req.headers.get("If-None-Match"), etag),
    };
  }

  /**
   * Builds a bodyless `304 Not Modified` response for validators that still
   * describe the client's copy. When the server negotiates a content encoding,
   * the 304 advertises `Vary: Accept-Encoding` exactly like the equivalent
   * `200`, so shared caches keep the negotiation dimension in their key.
   */
  private notModified(res: Res, headers: Record<string, string>): Response {
    const encoding = res.configuredEncoding;
    if (encoding && encoding !== "none") {
      headers.Vary = appendVary(headers.Vary, "Accept-Encoding");
    }
    return new Response(null, { status: 304, headers });
  }

  /**
   * Serves the request from this server's root.
   *
   * Files at or below 50 KB are buffered and kept in an in-memory cache; files
   * above it are streamed from disk on every request. Each cached entry is
   * revalidated with one cheap `stat()` per request: when the file's
   * modification time or size changed on disk, the entry is dropped and the
   * bytes are read again, so an edited asset is served immediately with a new
   * content-hash `ETag`. Entries also expire after the 15-minute TTL, as
   * before. With the `dev` option the in-memory cache is bypassed entirely and
   * every request reads fresh bytes.
   *
   * @param lookupPath - Optional already-decoded path to resolve instead of the
   * request pathname. Scoped mounts use it to serve a prefix-stripped path;
   * when omitted the request URL is decoded exactly as before.
   */
  public async serve(
    req: Req,
    res: Res,
    lookupPath?: string,
  ): Promise<Response> {
    let pathname: string;
    if (lookupPath === undefined) {
      try {
        pathname = decodeURIComponent(req.url.pathname);
      } catch {
        return res.error(400, "Bad Request");
      }
    } else {
      pathname = lookupPath;
    }
    if (pathname.includes("\0")) return res.error(400, "Bad Request");

    const candidate = resolve(this.absoluteClientPath, `.${pathname}`);
    const relativeCandidate = relative(this.absoluteClientPath, candidate);

    if (
      relativeCandidate === ".." ||
      relativeCandidate.startsWith(`..${sep}`) ||
      isAbsolute(relativeCandidate)
    ) {
      return res.error(403, "Forbidden");
    }

    let rootPath: string;
    let targetDiskLocation: string;
    try {
      [rootPath, targetDiskLocation] = await Promise.all([
        realpath(this.absoluteClientPath),
        realpath(candidate),
      ]);
    } catch {
      return res.null(404);
    }

    const relativeTarget = relative(rootPath, targetDiskLocation);
    if (
      relativeTarget === ".." ||
      relativeTarget.startsWith(`..${sep}`) ||
      isAbsolute(relativeTarget)
    ) {
      return res.error(403, "Forbidden");
    }

    const currentTime = Date.now();
    // Development mode never reads the shared module cache either: the map is
    // process-wide, so another server in the same process may have filled it.
    let cached = this.dev ? undefined : fileCache.get(targetDiskLocation);

    // 1. LAZY EXPIRATION GUARD: If the item exists but has expired, dump it!
    if (cached && currentTime > cached.expiresAt) {
      fileCache.delete(targetDiskLocation);
      cached = undefined; // Force a fresh disk read block below
    }

    // 2. METADATA REVALIDATION: one cheap stat per request stands in for
    // trusting the TTL alone, so an asset edited in place (same size or not)
    // can never serve a stale body or a stale ETag.
    if (cached) {
      const entry = cached;
      let stale = false;
      try {
        const { mtimeMs, size } = await stat(targetDiskLocation);
        stale = mtimeMs !== entry.mtimeMs || size !== entry.size;
      } catch {
        // Vanished or unreadable: drop the entry and let the read below decide.
        stale = true;
      }
      if (stale) {
        fileCache.delete(targetDiskLocation);
        cached = undefined;
      }
    }

    if (!cached) {
      const filePointer = Bun.file(targetDiskLocation);
      if (!(await filePointer.exists())) return res.null(404);

      if (filePointer.size <= this.SMALL_FILE_THRESHOLD) {
        // Snapshot metadata before reading. If the file is rewritten mid-read,
        // the recorded mtime is older than the bytes, so the following request
        // revalidates instead of trusting a body that only looks fresh.
        let mtimeMs: number;
        let size: number;
        try {
          ({ mtimeMs, size } = await stat(targetDiskLocation));
        } catch {
          return res.null(404);
        }

        const arrayBuffer = await filePointer.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);

        cached = {
          buffer,
          contentType: filePointer.type || "application/octet-stream",
          etag: `W/"${Bun.hash(buffer).toString(16)}"`,
          expiresAt: currentTime + this.CACHE_TTL, // Set the expiration window
          mtimeMs,
          size,
        };

        if (!this.dev) {
          ensureCacheCapacity(currentTime);
          fileCache.set(targetDiskLocation, cached);
        }
      }
    }

    // 3. EXECUTION DISPATCH MATRIX
    if (cached) {
      const { headers, notModified } = this.validators(req, cached.etag);

      if (notModified) {
        return this.notModified(res, headers);
      }

      // Pass meta so the universal handler knows how to treat the buffer
      return res.file(
        cached.buffer,
        {
          type: cached.contentType,
          size: cached.buffer.length,
        },
        headers,
      );
    }

    // Fallback for large asset structures: stat metadata gives a weak validator
    // without buffering the body in memory.
    const largeFilePointer = Bun.file(targetDiskLocation);
    if (await largeFilePointer.exists()) {
      const { size, mtimeMs } = await stat(targetDiskLocation);
      const etag = `W/"${Bun.hash(`${size}-${mtimeMs}`).toString(16)}"`;
      const { headers, notModified } = this.validators(req, etag, mtimeMs);

      if (notModified) {
        return this.notModified(res, headers);
      }

      return res.file(largeFilePointer, undefined, headers);
    }

    return res.null(404);
  }
}
