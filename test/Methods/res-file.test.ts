import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StaticFileServer } from "../../src/core/static-server";
import { Req } from "../../src/http/req";
import { Res } from "../../src/http/res";
import type { ContentEncodingType } from "../../src/http/res/res.compressor";
import type { FileMeta } from "../../src/http/res/res.http";

const CONTENT = "0123456789abcdef";
const SIZE = CONTENT.length;
const LAST_MODIFIED = Date.UTC(2024, 0, 1, 12, 0, 0);

let root: string;
let samplePath: string;
let emptyPath: string;
let staticServer: StaticFileServer;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rossa-res-file-"));
  samplePath = join(root, "sample.txt");
  emptyPath = join(root, "empty.txt");
  await writeFile(samplePath, CONTENT);
  await writeFile(emptyPath, "");
  staticServer = new StaticFileServer(root);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeRes(
  request: Request,
  encoding: ContentEncodingType = "none",
): Res {
  const req = new Req(
    request,
    undefined,
    staticServer.isFile.bind(staticServer),
  );
  return new Res({ encoding }, req, staticServer);
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/file", { headers });
}

async function bodyBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

async function bodyText(response: Response): Promise<string> {
  return new TextDecoder().decode(await bodyBytes(response));
}

async function serveSample(
  headers: Record<string, string> = {},
  meta?: FileMeta,
  encoding: ContentEncodingType = "none",
): Promise<Response> {
  return makeRes(request(headers), encoding).file(
    Bun.file(samplePath),
    meta,
  );
}

const BUFFER = new TextEncoder().encode(CONTENT);

describe("res.file ranges", () => {
  it("serves an exact 206 slice with correct representation headers", async () => {
    const response = await serveSample({ Range: "bytes=2-5" });

    expect(response.status).toBe(206);
    expect(await bodyText(response)).toBe("2345");
    expect(response.headers.get("content-range")).toBe(`bytes 2-5/${SIZE}`);
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("content-encoding")).toBeNull();
  });

  it("does not advertise a negotiated encoding on a 206 identity slice", async () => {
    const response = await serveSample(
      { Range: "bytes=0-3", "Accept-Encoding": "br" },
      undefined,
      "br",
    );

    expect(response.status).toBe(206);
    expect(await bodyText(response)).toBe("0123");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBe("4");
  });

  it("serves suffix and open-ended ranges with clamped ends", async () => {
    const suffix = await serveSample({ Range: "bytes=-6" });
    expect(suffix.status).toBe(206);
    expect(await bodyText(suffix)).toBe("abcdef");
    expect(suffix.headers.get("content-range")).toBe(
      `bytes 10-15/${SIZE}`,
    );

    const clamped = await serveSample({ Range: "bytes=10-999" });
    expect(clamped.status).toBe(206);
    expect(await bodyText(clamped)).toBe("abcdef");
    expect(clamped.headers.get("content-length")).toBe("6");

    const openEnded = await serveSample({ Range: "bytes=10-" });
    expect(openEnded.status).toBe(206);
    expect(await bodyText(openEnded)).toBe("abcdef");

    const openBoth = await serveSample({ Range: "bytes=0-0" });
    expect(openBoth.status).toBe(206);
    expect(await bodyText(openBoth)).toBe("0");
  });

  it("parses the range unit case-insensitively", async () => {
    const response = await serveSample({ Range: "Bytes=0-0" });

    expect(response.status).toBe(206);
    expect(await bodyText(response)).toBe("0");
    expect(response.headers.get("content-range")).toBe(`bytes 0-0/${SIZE}`);
  });

  it("returns 416 with representation headers for an unsatisfiable range", async () => {
    const response = await serveSample({ Range: "bytes=5-2" });

    expect(response.status).toBe(416);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-range")).toBe(`bytes */${SIZE}`);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toContain("text/plain");
  });

  it("keeps caller headers on 416", async () => {
    const res = makeRes(request({ Range: "bytes=5-2" }));
    res.header({ "X-Caller": "kept" });
    const response = await res.file(Bun.file(samplePath));

    expect(response.status).toBe(416);
    expect(response.headers.get("x-caller")).toBe("kept");
  });

  it("serves the first satisfiable entry of a multi-range request", async () => {
    const response = await serveSample({ Range: "bytes=0-1,5-6" });

    expect(response.status).toBe(206);
    expect(await bodyText(response)).toBe("01");
    expect(response.headers.get("content-range")).toBe(`bytes 0-1/${SIZE}`);
    expect(response.headers.get("content-length")).toBe("2");
  });

  it("returns 416 when every entry is unsatisfiable or the unit is wrong", async () => {
    const multi = await serveSample({ Range: "bytes=99-100,5-2" });
    expect(multi.status).toBe(416);
    expect(multi.headers.get("content-range")).toBe(`bytes */${SIZE}`);

    const wrongUnit = await serveSample({ Range: "items=0-1" });
    expect(wrongUnit.status).toBe(416);

    const malformed = await serveSample({ Range: "bytes" });
    expect(malformed.status).toBe(416);
  });

  it("returns 416 with a zero length for an empty file", async () => {
    const response = await makeRes(request({ Range: "bytes=0-0" })).file(
      Bun.file(emptyPath),
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */0");
  });
});

describe("res.file buffers", () => {
  it("ignores ranges and reports Accept-Ranges: none by default", async () => {
    const response = await makeRes(request({ Range: "bytes=0-1" })).file(
      BUFFER,
      { type: "text/plain" },
    );

    expect(response.status).toBe(200);
    expect(await bodyText(response)).toBe(CONTENT);
    expect(response.headers.get("accept-ranges")).toBe("none");
    expect(response.headers.get("content-length")).toBe(String(BUFFER.length));
  });

  it("uses the real buffer length when meta.size is missing or wrong", async () => {
    const noMeta = await makeRes(request()).file(BUFFER);
    expect(noMeta.headers.get("content-length")).toBe(String(BUFFER.length));

    const negative = await makeRes(request()).file(BUFFER, {
      type: "text/plain",
      size: -5,
    });
    expect(negative.headers.get("content-length")).toBe(
      String(BUFFER.length),
    );

    const mismatched = await makeRes(request()).file(BUFFER, {
      type: "text/plain",
      size: 999,
    });
    expect(mismatched.headers.get("content-length")).toBe(
      String(BUFFER.length),
    );
  });

  it("serves exact buffer ranges when ranges: true", async () => {
    const response = await makeRes(request({ Range: "bytes=2-5" })).file(
      BUFFER,
      { type: "text/plain", ranges: true },
    );

    expect(response.status).toBe(206);
    expect(await bodyText(response)).toBe("2345");
    expect(response.headers.get("content-range")).toBe(`bytes 2-5/${SIZE}`);
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
  });

  it("returns the 416 shape for unsatisfiable buffer ranges", async () => {
    const response = await makeRes(request({ Range: "bytes=5-2" })).file(
      BUFFER,
      { type: "text/plain", ranges: true },
    );

    expect(response.status).toBe(416);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-range")).toBe(`bytes */${SIZE}`);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toContain("text/plain");
  });

  it("returns 416 for any range against an empty buffer", async () => {
    const response = await makeRes(request({ Range: "bytes=0-0" })).file(
      new Uint8Array(0),
      { type: "text/plain", ranges: true },
    );

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */0");
  });

  it("keeps buffer range responses identity-encoded", async () => {
    const response = await makeRes(
      request({ Range: "bytes=0-3", "Accept-Encoding": "br" }),
      "br",
    ).file(BUFFER, { type: "text/plain", ranges: true });

    expect(response.status).toBe(206);
    expect(await bodyText(response)).toBe("0123");
    expect(response.headers.get("content-encoding")).toBeNull();
  });
});

describe("res.file validators and conditional GETs", () => {
  const meta: FileMeta = { etag: '"abc123"', lastModified: LAST_MODIFIED };

  it("emits ETag and Last-Modified when supplied", async () => {
    const response = await serveSample({}, meta);

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"abc123"');
    expect(response.headers.get("last-modified")).toBe(
      new Date(LAST_MODIFIED).toUTCString(),
    );
  });

  it("does not emit validators when meta omits them", async () => {
    const response = await serveSample();

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("last-modified")).toBeNull();
  });

  it("answers exact, weak, list, and wildcard If-None-Match with 304", async () => {
    for (const value of ['"abc123"', 'W/"abc123"', '"nope", "abc123"', "*"]) {
      const response = await serveSample({ "If-None-Match": value }, meta);
      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
      expect(response.headers.get("etag")).toBe('"abc123"');
      expect(response.headers.get("last-modified")).toBe(
        new Date(LAST_MODIFIED).toUTCString(),
      );
    }
  });

  it("serves 200 when If-None-Match does not match", async () => {
    const response = await serveSample(
      { "If-None-Match": '"other"' },
      meta,
    );

    expect(response.status).toBe(200);
    expect(await bodyText(response)).toBe(CONTENT);
  });

  it("honors If-Modified-Since when If-None-Match is absent", async () => {
    const response = await serveSample(
      { "If-Modified-Since": new Date(LAST_MODIFIED).toUTCString() },
      meta,
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("serves 200 for an older If-Modified-Since date", async () => {
    const response = await serveSample(
      { "If-Modified-Since": new Date(LAST_MODIFIED - 86_400_000).toUTCString() },
      meta,
    );

    expect(response.status).toBe(200);
  });

  it("evaluates If-None-Match before range handling", async () => {
    const response = await serveSample(
      { "If-None-Match": '"abc123"', Range: "bytes=0-1" },
      meta,
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("prefers If-None-Match over If-Modified-Since", async () => {
    const response = await serveSample(
      {
        "If-None-Match": '"other"',
        "If-Modified-Since": new Date(LAST_MODIFIED).toUTCString(),
      },
      meta,
    );

    expect(response.status).toBe(200);
  });
});

describe("res.file If-Range", () => {
  const meta: FileMeta = { etag: '"v1"', lastModified: LAST_MODIFIED };

  it("serves the range when the entity tag matches", async () => {
    const response = await serveSample(
      { Range: "bytes=0-1", "If-Range": 'W/"v1"' },
      meta,
    );

    expect(response.status).toBe(206);
    expect(await bodyText(response)).toBe("01");
  });

  it("serves the full representation when the entity tag is stale", async () => {
    const response = await serveSample(
      { Range: "bytes=0-1", "If-Range": '"old"' },
      meta,
    );

    expect(response.status).toBe(200);
    expect(await bodyText(response)).toBe(CONTENT);
    expect(response.headers.get("content-range")).toBeNull();
    expect(response.headers.get("etag")).toBe('"v1"');
  });

  it("honors a matching HTTP-date and rejects a stale one", async () => {
    const matching = await serveSample(
      {
        Range: "bytes=0-1",
        "If-Range": new Date(LAST_MODIFIED).toUTCString(),
      },
      meta,
    );
    expect(matching.status).toBe(206);

    const stale = await serveSample(
      {
        Range: "bytes=0-1",
        "If-Range": new Date(LAST_MODIFIED - 86_400_000).toUTCString(),
      },
      meta,
    );
    expect(stale.status).toBe(200);
    expect(await bodyText(stale)).toBe(CONTENT);
  });

  it("ignores If-Range when the referenced validator is unavailable", async () => {
    const response = await serveSample(
      { Range: "bytes=0-1", "If-Range": '"unavailable"' },
      { lastModified: LAST_MODIFIED },
    );

    expect(response.status).toBe(206);
    expect(await bodyText(response)).toBe("01");
  });
});

describe("res.file 404 and Vary", () => {
  it("returns the JSON error envelope for a missing Bun file", async () => {
    const response = await makeRes(request()).file(
      Bun.file(join(root, "missing.txt")),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).toBe(
      '{"success":false,"error":"File Not Found"}',
    );
  });

  it("adds Vary: Accept-Encoding to full compressed responses", async () => {
    const response = await serveSample(
      { "Accept-Encoding": "br" },
      undefined,
      "br",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBe("br");
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
  });

  it("adds Vary even when negotiation chooses identity", async () => {
    const response = await serveSample({}, undefined, "br");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
  });

  it("appends to a caller supplied Vary value", async () => {
    const res = makeRes(request({ "Accept-Encoding": "br" }), "br");
    res.header({ Vary: "Origin" });
    const response = await res.file(Bun.file(samplePath));

    expect(response.headers.get("vary")).toBe("Origin, Accept-Encoding");
  });

  it("does not add Vary to 206 range responses", async () => {
    const response = await serveSample(
      { Range: "bytes=0-1", "Accept-Encoding": "br" },
      undefined,
      "br",
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("vary")).toBeNull();
  });

  it("does not add Vary when compression is disabled", async () => {
    const response = await serveSample(
      { "Accept-Encoding": "br" },
      undefined,
      "none",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBeNull();
  });

  it("exposes the configured encoding before negotiation", () => {
    expect(makeRes(request(), "br").configuredEncoding).toBe("br");
    expect(makeRes(request(), "none").configuredEncoding).toBe("none");
  });
});
