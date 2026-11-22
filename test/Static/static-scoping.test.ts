import { afterEach, beforeAll, afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ctx } from "../../src/http/ctx";
import {
  Methods,
  Rossa,
  createGuard,
  route,
  staticFiles,
  use,
} from "../../src/index";
import { getFreePort } from "../helpers";

let base: string;
let publicRoot: string;
let privateRoot: string;
let outsideFile: string;

const servers: Array<{ stop: (closeActiveConnections?: boolean) => unknown }> =
  [];

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "rossa-static-scope-"));
  publicRoot = join(base, "public");
  privateRoot = join(base, "private");
  outsideFile = join(base, "outside.txt");

  await mkdir(join(publicRoot, "assets"), { recursive: true });
  await mkdir(privateRoot, { recursive: true });

  await writeFile(join(publicRoot, "assets", "app.js"), "console.log('asset')");
  await writeFile(join(publicRoot, "report.pdf"), "public pdf");
  await writeFile(join(publicRoot, "assetsfoo.png"), "outside prefix");
  await writeFile(join(publicRoot, "secret.txt"), "public secret");
  await writeFile(join(publicRoot, "outside.txt"), "public outside");

  await writeFile(join(privateRoot, "logo.png"), "private logo");
  await writeFile(join(privateRoot, "secret.txt"), "private secret");
  await writeFile(join(privateRoot, "manual.pdf"), "private manual");

  await writeFile(outsideFile, "outside root");
  await symlink(outsideFile, join(privateRoot, "escape.txt"));
});

afterEach(async () => {
  for (const server of servers) await server.stop(true);
  servers.length = 0;
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

async function start(app: Rossa): Promise<string> {
  const server = app.serve({
    hostname: "127.0.0.1",
    port: await getFreePort(),
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

@route("/report.pdf")
class ReportRoute extends Methods {
  get({ res }: ctx): Response {
    return res.json({ route: "report" });
  }
}

@route("/assetsfoo.png")
class BoundaryRoute extends Methods {
  get({ res }: ctx): Response {
    return res.json({ route: "boundary" });
  }
}

const denyAll = createGuard<void>(async (ctx) =>
  ctx.res.error(401, "denied"),
)();

describe("scoped static file mounts", () => {
  it("keeps the default global mount behavior", async () => {
    const app = new Rossa({
      Encoding: "none",
      clientPath: publicRoot,
      fileExtensions: ["pdf"],
    });
    app.register(ReportRoute);
    app.use(staticFiles());
    const origin = await start(app);

    // A global mount still answers file-like paths before the matching route.
    const pdf = await fetch(`${origin}/report.pdf`);
    expect(pdf.status).toBe(200);
    expect(await pdf.text()).toBe("public pdf");

    const head = await fetch(`${origin}/report.pdf`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toContain("pdf");
    expect(await head.text()).toBe("");
  });

  it("scopes interception to a prefix and lets file-like routes through", async () => {
    const app = new Rossa({
      Encoding: "none",
      clientPath: publicRoot,
      fileExtensions: ["pdf"],
    });
    app.register(ReportRoute, BoundaryRoute);
    app.use(staticFiles({ prefix: "/assets" }));
    const origin = await start(app);

    const asset = await fetch(`${origin}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("console.log('asset')");

    // `/report.pdf` is outside the prefix, so routing answers it even though a
    // file with the same name exists in the app-wide client directory.
    const report = await fetch(`${origin}/report.pdf`);
    expect(report.status).toBe(200);
    expect(await report.json()).toEqual({ route: "report" });

    // `/assets` must not match `/assetsfoo.png` as a substring.
    const boundary = await fetch(`${origin}/assetsfoo.png`);
    expect(boundary.status).toBe(200);
    expect(await boundary.json()).toEqual({ route: "boundary" });
  });

  it("serves a scoped root, strips the prefix, and refuses outside paths", async () => {
    const app = new Rossa({ Encoding: "none", clientPath: publicRoot });
    app.use(
      staticFiles({
        prefix: "/files",
        root: privateRoot,
        extensions: ["pdf"],
      }),
    );
    const origin = await start(app);

    const logo = await fetch(`${origin}/files/logo.png`);
    expect(logo.status).toBe(200);
    expect(await logo.text()).toBe("private logo");

    // Mount-specific extensions are recognized without app-wide configuration.
    const manual = await fetch(`${origin}/files/manual.pdf`);
    expect(manual.status).toBe(200);
    expect(await manual.text()).toBe("private manual");

    // The same relative path also exists under the app-wide client directory;
    // the mount root wins.
    const secret = await fetch(`${origin}/files/secret.txt`);
    expect(secret.status).toBe(200);
    expect(await secret.text()).toBe("private secret");

    // Only the app-wide client directory has this file, so the mount must not
    // serve it from outside its root.
    const outside = await fetch(`${origin}/files/outside.txt`);
    expect(outside.status).toBe(404);
    expect(await outside.text()).not.toContain("public outside");

    // The guard decodes before matching the prefix.
    const encodedPrefix = await fetch(`${origin}/%66iles/logo.png`);
    expect(encodedPrefix.status).toBe(200);
    expect(await encodedPrefix.text()).toBe("private logo");

    const head = await fetch(`${origin}/files/logo.png`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("keeps traversal and symlink defenses inside a scoped root", async () => {
    const app = new Rossa({ Encoding: "none", clientPath: publicRoot });
    app.use(staticFiles({ prefix: "/files", root: privateRoot }));
    const origin = await start(app);

    const traversal = await fetch(`${origin}/files/..%2F..%2Foutside.txt`);
    expect(traversal.status).toBe(403);

    const symlinkEscape = await fetch(`${origin}/files/escape.txt`);
    expect(symlinkEscape.status).toBe(403);
  });

  it("runs authentication before a scoped mount registered as a route guard", async () => {
    @route("/files/secret.txt")
    @use(denyAll, staticFiles({ prefix: "/files", root: privateRoot }))
    class DeniedFiles extends Methods {
      get({ res }: ctx): Response {
        return res.json({ route: "denied" });
      }
    }

    @route("/files/secret.txt")
    @use(staticFiles({ prefix: "/files", root: privateRoot }))
    class OpenFiles extends Methods {
      get({ res }: ctx): Response {
        return res.json({ route: "open" });
      }
    }

    const deniedApp = new Rossa({ Encoding: "none", clientPath: publicRoot });
    deniedApp.register(DeniedFiles);
    const deniedOrigin = await start(deniedApp);

    const denied = await fetch(`${deniedOrigin}/files/secret.txt`);
    expect(denied.status).toBe(401);
    expect(await denied.text()).not.toContain("private secret");

    const openApp = new Rossa({ Encoding: "none", clientPath: publicRoot });
    openApp.register(OpenFiles);
    const openOrigin = await start(openApp);

    const open = await fetch(`${openOrigin}/files/secret.txt`);
    expect(open.status).toBe(200);
    expect(await open.text()).toBe("private secret");
  });

  it("keeps scoped mounts behind earlier-running global auth guards", async () => {
    const app = new Rossa({ Encoding: "none", clientPath: publicRoot });
    app.use(staticFiles({ prefix: "/files", root: privateRoot }));
    app.use(denyAll);
    const origin = await start(app);

    const denied = await fetch(`${origin}/files/secret.txt`);
    expect(denied.status).toBe(401);
    expect(await denied.text()).not.toContain("private secret");
  });
});
