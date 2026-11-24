import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Rossa, staticFiles } from "../../src/index";
import { getFreePort } from "../helpers";

const CACHE_CONTROL = "public, max-age=900, must-revalidate";
const SMALL_THRESHOLD = 50 * 1024;

let root: string;

const servers: Array<{ stop: (closeActiveConnections?: boolean) => unknown }> =
  [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rossa-static-cache-"));

  await writeFile(join(root, "large.js"), "a".repeat(SMALL_THRESHOLD + 1024));
  await writeFile(join(root, "small.js"), "console.log('small')");
});

afterEach(async () => {
  for (const server of servers) await server.stop(true);
  servers.length = 0;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function start(): Promise<string> {
  const app = new Rossa({ Encoding: "none", clientPath: root });
  app.use(staticFiles());
  const server = app.serve({
    hostname: "127.0.0.1",
    port: await getFreePort(),
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

describe("static file cache validators", () => {
  it("sends validators for files above the small-file threshold", async () => {
    const origin = await start();
    const response = await fetch(`${origin}/large.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toMatch(/^W\/".+"$/);
    expect(response.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(response.headers.get("last-modified")).toBeTruthy();

    const body = await response.text();
    expect(body.length).toBe(SMALL_THRESHOLD + 1024);
  });

  it("answers a matching If-None-Match on a large file with 304 and no body", async () => {
    const origin = await start();

    const first = await fetch(`${origin}/large.js`);
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();
    await first.arrayBuffer();

    const second = await fetch(`${origin}/large.js`, {
      headers: { "If-None-Match": etag as string },
    });

    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
    expect(second.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(second.headers.get("last-modified")).toBeTruthy();
  });

  it("keeps the content-hash validator for small files", async () => {
    const origin = await start();
    const response = await fetch(`${origin}/small.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(CACHE_CONTROL);

    const expected = `W/"${Bun.hash(
      new Uint8Array(await Bun.file(join(root, "small.js")).arrayBuffer()),
    ).toString(16)}"`;
    expect(response.headers.get("etag")).toBe(expected);
    expect(await response.text()).toBe("console.log('small')");
  });

  it("returns a 304 without a body for a matching small-file ETag", async () => {
    const origin = await start();

    const first = await fetch(`${origin}/small.js`);
    const etag = first.headers.get("etag");
    await first.arrayBuffer();

    const second = await fetch(`${origin}/small.js`, {
      headers: { "If-None-Match": etag as string },
    });

    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
  });

  it("does not send cache headers on a 404", async () => {
    const origin = await start();
    const response = await fetch(`${origin}/missing.js`);

    expect(response.status).toBe(404);
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("last-modified")).toBeNull();
  });
});
