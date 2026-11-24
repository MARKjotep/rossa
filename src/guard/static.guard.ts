import { isFile, StaticFileServer } from "@/core/static-server";
import { createGuard } from "./@/base.guard";

/** Configuration for a {@link staticFiles} mount. */
export interface StaticFilesOptions {
  /**
   * Restricts this mount to request paths under the given prefix. The decoded
   * pathname is compared at a path-segment boundary, so `/assets` matches
   * `/assets` and `/assets/app.js` but not `/assetsfoo.png`. Requests outside
   * the prefix fall through to the remaining guards and routes, which keeps
   * authentication and route handling reachable. Omit it to intercept every
   * file-like path, as a global static mount does.
   */
  prefix?: string;

  /**
   * Directory this mount serves from. Relative paths resolve against
   * `process.cwd()`; absolute paths are used as-is. When set, the mount uses a
   * dedicated static file server instead of the app-wide `clientPath` server.
   * With a `prefix`, the prefix is stripped before the lookup, so
   * `/files/logo.png` maps to `<root>/logo.png`. Without a prefix the full
   * request path is used.
   */
  root?: string;

  /**
   * Additional file extensions recognized by this mount, with or without a
   * leading dot. They extend the built-in extension list but do not replace
   * the app-wide `fileExtensions` configuration.
   */
  extensions?: string[];

  /**
   * Development flag: disables the ≤ 50 KB in-memory cache for this mount so
   * edited assets are always fresh. Every request re-reads the file, so the
   * body and its content-hash `ETag` always reflect the bytes on disk. Files
   * above the 50 KB threshold already skip the cache, so the flag has no
   * effect on them. Requires `root`: without it the mount uses the app-wide
   * server, whose cache is shared by every mount and cannot be opted out of
   * here.
   */
  dev?: boolean;
}

interface ScopedMount {
  server: StaticFileServer | undefined;
  isFile: (pathname: string) => boolean;
}

/** One dedicated mount per options object, so its server is created once. */
const scopedMounts = new WeakMap<StaticFilesOptions, ScopedMount>();

/**
 * Resolves the dedicated file server and detector for a scoped mount. Returns
 * `undefined` for a plain global mount, which keeps the app-wide server.
 */
function getScopedMount(
  options: StaticFilesOptions,
): ScopedMount | undefined {
  const root = options.root?.trim();
  const extensions = options.extensions?.filter((item) => item.trim()) ?? [];
  if (!root && extensions.length === 0) return undefined;

  let mount = scopedMounts.get(options);
  if (!mount) {
    const server = root
      ? new StaticFileServer(root, extensions, { dev: options.dev === true })
      : undefined;
    const additional = new Set(extensions);
    mount = {
      server,
      isFile: server
        ? (pathname) => server.isFile(pathname)
        : (pathname) => isFile(pathname, additional),
    };
    scopedMounts.set(options, mount);
  }
  return mount;
}

/** Normalizes a mount prefix to a leading-slash, no-trailing-slash form. */
function normalizePrefix(prefix: string | undefined): string | undefined {
  if (!prefix) return undefined;

  let normalized = prefix.trim().replace(/\/+$/, "");
  if (!normalized) return undefined;
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  return normalized;
}

/** Matches a pathname against a prefix at a full path-segment boundary. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Serves requests for file-like paths through a static file server.
 * Only GET and HEAD requests are intercepted; HEAD responses keep the file
 * headers but drop the body.
 *
 * Without options it behaves like a global mount: every recognized file-like
 * path is served from the app-wide `clientPath` server before route guards run.
 * Pass `prefix` and/or `root` to scope a mount, for example
 * `staticFiles({ prefix: "/files", root: "./private-files" })` registered
 * behind an authentication guard.
 *
 * @param options - Optional prefix, root, extension, and development configuration.
 * @returns A guard factory that serves static assets before route handling.
 */
export const staticFiles = createGuard<StaticFilesOptions>(
  async (ctx, next, options) => {
    if (!["GET", "HEAD"].includes(ctx.req.method)) return next();

    const config = options ?? {};
    const prefix = normalizePrefix(config.prefix);
    let pathname = ctx.req.path;

    if (prefix) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(pathname);
      } catch {
        // Malformed encoding is left to the remaining guards and routes.
        return next();
      }

      if (!matchesPrefix(decoded, prefix)) return next();
      pathname = decoded;
    }

    const mount = getScopedMount(config);
    const isFile = ctx.req.isFile || (mount ? mount.isFile(pathname) : false);
    if (!isFile) return next();

    // A scoped root is addressed relative to its mount prefix.
    const lookup =
      prefix && mount?.server
        ? pathname.slice(prefix.length) || "/"
        : undefined;
    const response = mount?.server
      ? await mount.server.serve(ctx.req, ctx.res, lookup)
      : await ctx.res.fileServer();

    if (ctx.req.method !== "HEAD") return response;

    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
  { id: "static-files" },
);
