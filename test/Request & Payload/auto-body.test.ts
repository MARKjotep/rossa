import { describe, expect, it } from "bun:test";
import { makeContext } from "../helpers";

function bodyRequest(
  body: BodyInit | null,
  contentType?: string,
  method = "POST",
): Request {
  return new Request("http://localhost/auto", {
    method,
    headers: contentType ? { "content-type": contentType } : {},
    body,
  });
}

describe("req.autoBody", () => {
  it("parses JSON by content type and caches the result", async () => {
    const raw = JSON.stringify({ name: "ada", admin: false });
    const context = makeContext(
      bodyRequest(raw, "application/json; charset=utf-8"),
    );

    const first = await context.req.autoBody<{ name: string; admin: boolean }>();
    expect(first.parsedWith).toBe("json");
    expect(first.body).toEqual({ name: "ada", admin: false });

    const second = await context.req.autoBody();
    expect(second.body).toBe(first.body);
    expect(await context.req.text()).toBe(raw);
  });

  it("returns FormData for url-encoded and multipart bodies", async () => {
    const urlencoded = makeContext(
      bodyRequest(
        "name=ada&tag=one&tag=two",
        "application/x-www-form-urlencoded",
      ),
    );
    const form = await urlencoded.req.autoBody<FormData>();

    expect(form.parsedWith).toBe("form");
    expect(form.body instanceof FormData).toBe(true);
    expect((form.body as FormData).get("name")).toBe("ada");
    expect((form.body as FormData).getAll("tag")).toEqual(["one", "two"]);
    expect(await urlencoded.req.form()).toBe(form.body as FormData);

    const boundary = "rossa-auto-body";
    const multipart = makeContext(
      bodyRequest(
        [
          `--${boundary}`,
          'Content-Disposition: form-data; name="note"',
          "",
          "keep",
          `--${boundary}--`,
          "",
        ].join("\r\n"),
        `multipart/form-data; boundary=${boundary}`,
      ),
    );
    const uploaded = await multipart.req.autoBody<FormData>();

    expect(uploaded.parsedWith).toBe("form");
    expect((uploaded.body as FormData).get("note")).toBe("keep");
  });

  it("returns raw text for other content types", async () => {
    const context = makeContext(bodyRequest("hello", "text/plain"));
    const result = await context.req.autoBody();

    expect(result.parsedWith).toBe("text");
    expect(result.body).toBe("hello");
  });

  it("reports an empty body as empty for text and form content types", async () => {
    const json = makeContext(bodyRequest(null, "application/json"));
    const emptyJson = await json.req.autoBody();
    expect(emptyJson).toEqual({ body: null, parsedWith: "empty" });

    const form = makeContext(
      bodyRequest(null, "application/x-www-form-urlencoded"),
    );
    const emptyForm = await form.req.autoBody();
    expect(emptyForm).toEqual({ body: null, parsedWith: "empty" });

    const none = makeContext(bodyRequest(null));
    expect(await none.req.autoBody()).toEqual({
      body: null,
      parsedWith: "empty",
    });
  });

  it("falls back to text for malformed JSON instead of throwing", async () => {
    const context = makeContext(bodyRequest("{broken", "application/json"));

    const result = await context.req.autoBody();

    expect(result.parsedWith).toBe("text");
    expect(result.body).toBe("{broken");
  });

  it("rejects bodies over the cap", async () => {
    const context = makeContext(bodyRequest("123456", "text/plain"));

    await expect(context.req.autoBody({ maxSize: 4 })).rejects.toThrow(
      "Payload exceeded maximum allowed size of 0.00390625 KB",
    );
  });
});
