import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
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
  await writeFile(join(root, "hello world.txt"), "spaced asset");
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

  it("serves suffix byte ranges with a valid Content-Range", async () => {
    const request = new Request("http://localhost/report.pdf", {
      headers: { range: "bytes=-6" },
    });
    const context = makeContext(request, { fileServer: staticServer });
    const response = await context.res.file(Bun.file(join(root, "report.pdf")));

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 10-15/16");
    expect(response.headers.get("content-length")).toBe("6");
    expect(await response.text()).toBe("ension");
  });

  it("serves percent-encoded names and rejects encoded traversal", async () => {
    const spacedContext = makeContext(
      new Request("http://localhost/hello%20world.txt"),
      {
        fileServer: staticServer,
        fileDetector: staticServer.isFile.bind(staticServer),
      },
    );
    const spaced = await staticFiles()(spacedContext, () => new Response("route"));
    expect(spaced.status).toBe(200);
    expect(await spaced.text()).toBe("spaced asset");

    const encodedTraversal = makeContext(
      new Request(`http://localhost/..%2F${basename(outsideFile)}`),
      {
        fileServer: staticServer,
        fileDetector: staticServer.isFile.bind(staticServer),
      },
    );
    const escaped = await staticFiles()(
      encodedTraversal,
      () => new Response("route"),
    );
    expect(escaped.status).toBe(403);
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
