import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Rossa, staticFiles } from "../../src/index";
import { getFreePort } from "../helpers";

const CACHE_CONTROL = "public, max-age=900, must-revalidate";

let root: string;

const servers: Array<{ stop: (closeActiveConnections?: boolean) => unknown }> =
  [];

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rossa-static-freshness-"));

  await writeFile(join(root, "same-size.js"), "console.log('one')");
  await writeFile(join(root, "growing.js"), "console.log('v1')");
});

afterEach(async () => {
  for (const server of servers) await server.stop(true);
  servers.length = 0;
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function start(
  options: { root?: string; dev?: boolean } = {},
): Promise<string> {
  const app = new Rossa({ Encoding: "none", clientPath: root });
  app.use(options.root ? staticFiles(options) : staticFiles());
  const server = app.serve({
    hostname: "127.0.0.1",
    port: await getFreePort(),
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

/** Reads a file's expected content-hash weak ETag straight from disk. */
async function contentEtag(path: string): Promise<string> {
  const buffer = new Uint8Array(await Bun.file(path).arrayBuffer());
  return `W/"${Bun.hash(buffer).toString(16)}"`;
}

describe("small-file cache freshness", () => {
  it("serves a same-size rewrite immediately with a new ETag", async () => {
    const origin = await start();
    const target = join(root, "same-size.js");
    const original = "console.log('one')";
    const rewritten = "console.log('two')";
    expect(rewritten.length).toBe(original.length);

    const first = await fetch(`${origin}/same-size.js`);
    const firstEtag = first.headers.get("etag") as string;
    expect(await first.text()).toBe(original);
    expect(firstEtag).toBe(await contentEtag(target));

    await writeFile(target, rewritten);

    const second = await fetch(`${origin}/same-size.js`);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(rewritten);

    const secondEtag = second.headers.get("etag") as string;
    expect(secondEtag).not.toBe(firstEtag);
    expect(secondEtag).toBe(await contentEtag(target));
    expect(second.headers.get("cache-control")).toBe(CACHE_CONTROL);

    // Restoring the original bytes restores the original validator, which also
    // proves the stale entry above was actually replaced.
    await writeFile(target, original);
    const third = await fetch(`${origin}/same-size.js`);
    expect(await third.text()).toBe(original);
    expect(third.headers.get("etag")).toBe(firstEtag);
  });

  it("serves a size-changing rewrite immediately", async () => {
    const origin = await start();
    const target = join(root, "growing.js");
    const original = "console.log('v1')";
    const rewritten = "console.log('version-two-is-longer')";

    const first = await fetch(`${origin}/growing.js`);
    const firstEtag = first.headers.get("etag") as string;
    expect(await first.text()).toBe(original);

    await writeFile(target, rewritten);

    const second = await fetch(`${origin}/growing.js`);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(rewritten);
    expect(second.headers.get("etag")).not.toBe(firstEtag);
    expect(second.headers.get("etag")).toBe(await contentEtag(target));
  });

  it("keeps serving an unchanged cached file with a stable ETag", async () => {
    const origin = await start();
    const target = join(root, "same-size.js");

    const first = await fetch(`${origin}/same-size.js`);
    const firstEtag = first.headers.get("etag") as string;
    const firstBody = await first.text();

    const second = await fetch(`${origin}/same-size.js`);
    const secondEtag = second.headers.get("etag") as string;
    const secondBody = await second.text();

    expect(second.status).toBe(200);
    expect(secondEtag).toBe(firstEtag);
    expect(secondBody).toBe(firstBody);
    expect(second.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(secondEtag).toBe(await contentEtag(target));

    // The cached entry still answers conditional requests.
    const third = await fetch(`${origin}/same-size.js`, {
      headers: { "If-None-Match": firstEtag },
    });
    expect(third.status).toBe(304);
    expect(await third.text()).toBe("");
  });
});

describe("static mount development mode", () => {
  it("never serves a stale cached body from a dev mount", async () => {
    await writeFile(join(root, "dev.js"), "console.log('dev-one')");
    const origin = await start({ root, dev: true });
    const target = join(root, "dev.js");

    const first = await fetch(`${origin}/dev.js`);
    const firstEtag = first.headers.get("etag") as string;
    expect(await first.text()).toBe("console.log('dev-one')");
    expect(firstEtag.startsWith('W/"')).toBe(true);
    expect(firstEtag).toBe(await contentEtag(target));

    // Same size, different bytes: a cached entry would keep the old body.
    await writeFile(target, "console.log('dev-two')");
    const second = await fetch(`${origin}/dev.js`);
    const secondEtag = second.headers.get("etag") as string;
    expect(await second.text()).toBe("console.log('dev-two')");
    expect(secondEtag).not.toBe(firstEtag);
    expect(secondEtag).toBe(await contentEtag(target));
    expect(second.headers.get("cache-control")).toBe(CACHE_CONTROL);

    // The ETag is recomputed from the bytes on every response, so a third edit
    // is visible even when it restores the original length again.
    await writeFile(target, "console.log('dev-3')");
    const third = await fetch(`${origin}/dev.js`);
    const thirdEtag = third.headers.get("etag") as string;
    expect(await third.text()).toBe("console.log('dev-3')");
    expect(thirdEtag).not.toBe(secondEtag);
    expect(thirdEtag).toBe(await contentEtag(target));
  });

  it("still answers conditional requests from a dev mount", async () => {
    await writeFile(join(root, "dev-conditional.js"), "console.log('shared')");
    const origin = await start({ root, dev: true });
    const first = await fetch(`${origin}/dev-conditional.js`);
    const etag = first.headers.get("etag") as string;
    await first.arrayBuffer();

    const second = await fetch(`${origin}/dev-conditional.js`, {
      headers: { "If-None-Match": etag },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
  });
});
