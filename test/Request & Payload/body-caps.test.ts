import { describe, expect, it } from "bun:test";
import { multipart } from "../../src/guard/multipart.guard";
import { urlencoded } from "../../src/guard/urlencoded.guard";
import { runGuard } from "../helpers";

const MIB = 1024 * 1024;

const urlencodedRequest = (
  body: string,
  headers: Record<string, string> = {},
): Request =>
  new Request("http://localhost/form", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body,
  });

function multipartRequest(
  boundary: string,
  parts: Array<{ name: string; value: string; type?: string }>,
  headers: Record<string, string> = {},
): Request {
  const chunks: string[] = [];
  for (const part of parts) {
    chunks.push(`--${boundary}`);
    const disposition =
      part.type === undefined
        ? `Content-Disposition: form-data; name="${part.name}"`
        : `Content-Disposition: form-data; name="${part.name}"; filename="${part.name}.bin"`;
    chunks.push(disposition);
    if (part.type !== undefined) chunks.push(`Content-Type: ${part.type}`);
    chunks.push("");
    chunks.push(part.value);
  }
  chunks.push(`--${boundary}--`, "");

  return new Request("http://localhost/upload", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      ...headers,
    },
    body: chunks.join("\r\n"),
  });
}

const oversizedError = (maxBytes: number) => ({
  success: false,
  error: `Payload exceeded maximum allowed size of ${maxBytes / 1024} KB`,
});

describe("urlencoded body cap", () => {
  it("rejects a body over the default 1 MiB cap with json()'s 413 shape", async () => {
    const body = `field=${"a".repeat(2 * MIB)}`;
    const { response, nextCalls } = await runGuard(
      urlencoded(),
      urlencodedRequest(body),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual(oversizedError(MIB));
    expect(nextCalls).toBe(0);
  });

  it("accepts a body at the default cap and rejects one byte more", async () => {
    const prefix = "field=";
    const atLimit = prefix + "a".repeat(MIB - prefix.length);
    const accepted = await runGuard(urlencoded(), urlencodedRequest(atLimit));

    expect(accepted.response.status).toBe(200);
    expect(accepted.nextCalls).toBe(1);
    expect((accepted.context.form.field as string).length).toBe(
      MIB - prefix.length,
    );

    const overLimit = await runGuard(
      urlencoded(),
      urlencodedRequest(`${atLimit}b`),
    );
    expect(overLimit.response.status).toBe(413);
    expect(overLimit.nextCalls).toBe(0);
  });

  it("honours an explicit maxSize in both directions", async () => {
    const body = `field=${"a".repeat(50)}`;

    const rejected = await runGuard(
      urlencoded({ maxSize: 10 }),
      urlencodedRequest(body),
    );
    expect(rejected.response.status).toBe(413);
    expect(await rejected.response.json()).toEqual(oversizedError(10));
    expect(rejected.nextCalls).toBe(0);

    const big = `field=${"a".repeat(MIB)}`;
    const accepted = await runGuard(
      urlencoded({ maxSize: 2 * MIB }),
      urlencodedRequest(big),
    );
    expect(accepted.response.status).toBe(200);
    expect(accepted.nextCalls).toBe(1);
    expect((accepted.context.form.field as string).length).toBe(MIB);
  });

  it("enforces the cap on received bytes when Content-Length lies", async () => {
    const body = `field=${"a".repeat(2 * MIB)}`;

    const lenient = await runGuard(
      urlencoded(),
      urlencodedRequest(body, { "content-length": "5" }),
    );
    expect(lenient.response.status).toBe(413);
    expect(lenient.nextCalls).toBe(0);

    const strict = await runGuard(
      urlencoded({ strict: true }),
      urlencodedRequest(body, { "content-length": "5" }),
    );
    expect(strict.response.status).toBe(413);
    expect(strict.nextCalls).toBe(0);
  });

  it("rejects an invalid Content-Length header like json()", async () => {
    const { response } = await runGuard(
      urlencoded(),
      urlencodedRequest("a=1", { "content-length": "1e2" }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      error: "Invalid Content-Length header",
    });
  });

  it("parses under-limit lenient and strict bodies exactly as before", async () => {
    const lenient = await runGuard(
      urlencoded(),
      urlencodedRequest("name=Ada&tag=one&tag=two&q=a+b&bad=%ZZ"),
    );
    expect(lenient.response.status).toBe(200);
    expect(lenient.context.form).toEqual({
      name: "Ada",
      tag: ["one", "two"],
      q: "a b",
      bad: "%ZZ",
    });

    const strict = await runGuard(
      urlencoded({ strict: true }),
      urlencodedRequest("name=Ada&tag=one&tag=two&q=a+b&plus=%2B"),
    );
    expect(strict.response.status).toBe(200);
    expect(strict.context.form).toEqual({
      name: "Ada",
      tag: ["one", "two"],
      q: "a b",
      plus: "+",
    });
  });
});

describe("multipart body cap", () => {
  it("rejects a body over the default 1 MiB cap with json()'s 413 shape", async () => {
    const { response, nextCalls } = await runGuard(
      multipart(),
      multipartRequest("rossa-limit", [
        { name: "file", value: "a".repeat(2 * MIB), type: "text/plain" },
      ]),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual(oversizedError(MIB));
    expect(nextCalls).toBe(0);
  });

  it("honours an explicit maxSize in both directions", async () => {
    const small = multipartRequest("rossa-small", [
      { name: "file", value: "a".repeat(2048), type: "text/plain" },
    ]);

    const rejected = await runGuard(multipart({ maxSize: 1024 }), small);
    expect(rejected.response.status).toBe(413);
    expect(await rejected.response.json()).toEqual(oversizedError(1024));
    expect(rejected.nextCalls).toBe(0);

    const accepted = await runGuard(
      multipart({ maxSize: 2 * MIB }),
      multipartRequest("rossa-big", [
        { name: "file", value: "a".repeat(MIB), type: "text/plain" },
      ]),
    );
    expect(accepted.response.status).toBe(200);
    expect(accepted.nextCalls).toBe(1);
    expect((accepted.context.form.file as File).size).toBe(MIB);
  });

  it("enforces the cap on received bytes when Content-Length lies", async () => {
    const { response, nextCalls } = await runGuard(
      multipart(),
      multipartRequest(
        "rossa-lying",
        [{ name: "file", value: "a".repeat(2 * MIB), type: "text/plain" }],
        { "content-length": "10" },
      ),
    );

    expect(response.status).toBe(413);
    expect(nextCalls).toBe(0);
  });

  it("keeps under-limit parsing, including File.type, unchanged", async () => {
    const { response, context, nextCalls } = await runGuard(
      multipart(),
      multipartRequest("rossa-ok", [
        { name: "note", value: "keep" },
        { name: "file", value: "plain", type: "application/octet-stream" },
      ]),
    );

    expect(response.status).toBe(200);
    expect(nextCalls).toBe(1);
    expect(context.form.note).toBe("keep");

    const file = context.form.file as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("application/octet-stream");
    expect(file.name).toBe("file.bin");
    expect(file.size).toBe("plain".length);
    expect(await file.text()).toBe("plain");
  });
});
