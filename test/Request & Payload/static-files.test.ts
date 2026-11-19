import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StaticFileServer } from "../../src/core/static-server";
import { staticFiles } from "../../src/guard/static.guard";
import { makeContext } from "../helpers";

let root: string;
let outsideFile: string;
let staticServer: StaticFileServer;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rossa-static-test-"));
  outsideFile = join(root, "..", `${root.split("/").at(-1)}-outside.pdf`);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "report.pdf"), "custom extension");
  await writeFile(join(root, "index.html"), "<h1>static</h1>");
  await writeFile(outsideFile, "outside root");
  await symlink(outsideFile, join(root, "escape.pdf"));
  staticServer = new StaticFileServer(root, ["pdf"]);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outsideFile, { force: true });
});

describe("static file guard", () => {
  it("recognizes built-in and configured extensions and serves content", async () => {
    const request = new Request("http://localhost/report.PDF");
    const context = makeContext(request, {
      fileServer: staticServer,
      fileDetector: staticServer.isFile.bind(staticServer),
    });
    expect(context.req.isFile).toBe(true);

    const response = await staticFiles()(context, () => new Response("route"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("custom extension");

    const htmlContext = makeContext(
      new Request("http://localhost/index.html"),
      {
        fileServer: staticServer,
        fileDetector: staticServer.isFile.bind(staticServer),
      },
    );
    const html = await staticFiles()(htmlContext, () => new Response("route"));
    expect(html.status).toBe(200);
    expect(await html.text()).toBe("<h1>static</h1>");
  });

  it("returns bodyless HEAD responses and blocks symlink escapes", async () => {
    const headRequest = new Request("http://localhost/report.pdf", {
      method: "HEAD",
    });
    const headContext = makeContext(headRequest, {
      fileServer: staticServer,
      fileDetector: staticServer.isFile.bind(staticServer),
    });
    const headResponse = await staticFiles()(
      headContext,
      () => new Response("route"),
    );
    expect(headResponse.status).toBe(200);
    expect(await headResponse.text()).toBe("");

    const escapedContext = makeContext(
      new Request("http://localhost/escape.pdf"),
      {
        fileServer: staticServer,
        fileDetector: staticServer.isFile.bind(staticServer),
      },
    );
    const escapedResponse = await staticFiles()(
      escapedContext,
      () => new Response("route"),
    );
    expect(escapedResponse.status).toBe(403);
  });
});
