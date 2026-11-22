import { isAbsolute, relative, resolve, sep } from "path";
import { realpath } from "node:fs/promises";
import type { Req } from "../http/req";
import type { Res } from "../http/res";

interface CachedFile {
  buffer: Uint8Array;
  contentType: string;
  etag: string;
  expiresAt: number; // UNIX epoch timestamp when this block goes stale
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
  private readonly SMALL_FILE_THRESHOLD = 50 * 1024; // 50 KB
  private readonly CACHE_TTL = 15 * 60 * 1000; // 15 Minutes in milliseconds

  constructor(resolvedAssetRootPath: string, additionalExtensions: string[] = []) {
    this.absoluteClientPath = resolve(resolvedAssetRootPath);
    this.additionalExtensions = new Set(
      additionalExtensions.map(normalizeExtension).filter(Boolean),
    );
  }

  isFile(path: string): boolean {
    return isFile(path, this.additionalExtensions);
  }

  public async serve(req: Req, res: Res): Promise<Response> {
    let pathname: string;
    try {
      pathname = decodeURIComponent(req.url.pathname);
    } catch {
      return res.error(400, "Bad Request");
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
    let cached = fileCache.get(targetDiskLocation);

    // 1. LAZY EXPIRATION GUARD: If the item exists but has expired, dump it!
    if (cached && currentTime > cached.expiresAt) {
      fileCache.delete(targetDiskLocation);
      cached = undefined; // Force a fresh disk read block below
    }

    if (!cached) {
      const filePointer = Bun.file(targetDiskLocation);
      if (!(await filePointer.exists())) return res.null(404);

      if (filePointer.size <= this.SMALL_FILE_THRESHOLD) {
        const arrayBuffer = await filePointer.arrayBuffer();
        const buffer = new Uint8Array(arrayBuffer);
        const etag = `W/"${Bun.hash(buffer).toString(16)}"`;

        cached = {
          buffer,
          contentType: filePointer.type || "application/octet-stream",
          etag,
          expiresAt: currentTime + this.CACHE_TTL, // Set the expiration window
        };

        ensureCacheCapacity(currentTime);
        fileCache.set(targetDiskLocation, cached);
      }
    }

    // 3. EXECUTION DISPATCH MATRIX
    if (cached) {
      const clientETag = req.headers.get("If-None-Match");

      const headers = {
        ETag: cached.etag,
        "Cache-Control": `public, max-age=${this.CACHE_TTL / 1000}, must-revalidate`,
      };

      if (clientETag === cached.etag) {
        return new Response(null, { status: 304, headers });
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

    // Fallback for large asset structures
    const largeFilePointer = Bun.file(targetDiskLocation);
    if (await largeFilePointer.exists()) {
      return res.file(largeFilePointer);
    }

    return res.null(404);
  }
}
