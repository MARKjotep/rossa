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

async function start(encoding: "none" | "br" = "none"): Promise<string> {
  const app = new Rossa({ Encoding: encoding, clientPath: root });
  app.use(staticFiles());
  const server = app.serve({
    hostname: "127.0.0.1",
    port: await getFreePort(),
  });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

/** Fetches `path` once and returns the response plus its weak ETag. */
async function firstResponse(
  origin: string,
  path: string,
): Promise<{ response: Response; etag: string }> {
  const response = await fetch(`${origin}${path}`);
  const etag = response.headers.get("etag");
  expect(etag).toBeTruthy();
  await response.arrayBuffer();
  return { response, etag: etag as string };
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
    const { etag } = await firstResponse(origin, "/large.js");

    const second = await fetch(`${origin}/large.js`, {
      headers: { "If-None-Match": etag },
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
    const { etag } = await firstResponse(origin, "/small.js");

    const second = await fetch(`${origin}/small.js`, {
      headers: { "If-None-Match": etag },
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

describe("RFC 9110 If-None-Match matching", () => {
  it("matches the wildcard against a cached small file", async () => {
    const origin = await start();
    const { etag } = await firstResponse(origin, "/small.js");

    const wildcard = await fetch(`${origin}/small.js`, {
      headers: { "If-None-Match": "*" },
    });

    expect(wildcard.status).toBe(304);
    expect(await wildcard.text()).toBe("");
    expect(wildcard.headers.get("etag")).toBe(etag);
  });

  it("matches any member of a comma-separated tag list", async () => {
    const origin = await start();
    const { etag } = await firstResponse(origin, "/small.js");

    const listed = await fetch(`${origin}/small.js`, {
      headers: { "If-None-Match": `"other", ${etag}, "third"` },
    });

    expect(listed.status).toBe(304);
    expect(await listed.text()).toBe("");
  });

  it("compares weakly, ignoring the W/ prefix on either side", async () => {
    const origin = await start();
    const { etag } = await firstResponse(origin, "/small.js");
    expect(etag.startsWith('W/"')).toBe(true);
    const strongForm = etag.slice(2);

    // A client echoing the weak form matches, and vice versa: the entity-tags
    // are compared on their opaque parts (RFC 9110 §8.8.3.2).
    for (const candidate of [etag, strongForm, `  ${strongForm}  `]) {
      const response = await fetch(`${origin}/small.js`, {
        headers: { "If-None-Match": candidate },
      });
      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
    }
  });

  it("serves the full body when no listed tag matches", async () => {
    const origin = await start();
    const { etag } = await firstResponse(origin, "/small.js");

    const miss = await fetch(`${origin}/small.js`, {
      headers: { "If-None-Match": '"other", W/"deadbeef"' },
    });

    expect(miss.status).toBe(200);
    expect(await miss.text()).toBe("console.log('small')");
    expect(miss.headers.get("etag")).toBe(etag);
  });

  it("applies the same matching rules to the stat-derived large-file ETag", async () => {
    const origin = await start();
    const { etag } = await firstResponse(origin, "/large.js");

    for (const candidate of ["*", `"other", ${etag}`, etag.slice(2)]) {
      const response = await fetch(`${origin}/large.js`, {
        headers: { "If-None-Match": candidate },
      });
      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
      expect(response.headers.get("etag")).toBe(etag);
    }

    const miss = await fetch(`${origin}/large.js`, {
      headers: { "If-None-Match": '"nope"' },
    });
    expect(miss.status).toBe(200);
    expect((await miss.text()).length).toBe(SMALL_THRESHOLD + 1024);
  });
});

describe("Vary on 304 responses", () => {
  it("advertises Vary: Accept-Encoding when the app negotiates encoding", async () => {
    const origin = await start("br");
    const { etag } = await firstResponse(origin, "/small.js");

    const second = await fetch(`${origin}/small.js`, {
      headers: { "If-None-Match": etag },
    });

    expect(second.status).toBe(304);
    expect(second.headers.get("vary")?.toLowerCase()).toContain(
      "accept-encoding",
    );
  });

  it("omits Vary when encoding is disabled", async () => {
    const origin = await start("none");
    const { etag } = await firstResponse(origin, "/small.js");

    const second = await fetch(`${origin}/small.js`, {
      headers: { "If-None-Match": etag },
    });

    expect(second.status).toBe(304);
    expect(second.headers.get("vary")).toBeNull();
  });
});
