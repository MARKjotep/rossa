import { describe, expect, it } from "bun:test";
import { multipart } from "../../src/guard/multipart.guard";
import { runGuard } from "../helpers";

function uploadRequest(form: FormData): Request {
  return new Request("http://localhost/upload", {
    method: "POST",
    body: form,
  });
}

describe("multipart MIME metadata", () => {
  it("preserves the uploaded File.type with name, size, and bytes intact", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const form = new FormData();
    form.append("name", "Ada");
    form.append(
      "file",
      new File([bytes], "bin.dat", { type: "application/octet-stream" }),
    );

    const { response, context, nextCalls } = await runGuard(
      multipart(),
      uploadRequest(form),
    );

    expect(response.status).toBe(200);
    expect(nextCalls).toBe(1);

    const file = context.form.file as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("application/octet-stream");
    expect(file.name).toBe("bin.dat");
    expect(file.size).toBe(bytes.byteLength);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(context.form.name).toBe("Ada");
  });

  it("keeps types aligned across interleaved fields and repeated uploads", async () => {
    const previous = new File(["old"], "a.txt", { type: "text/plain" });
    const current = new File(["new"], "b.json", { type: "application/json" });
    const form = new FormData();
    form.append("previous", previous);
    form.append("note", "keep");
    form.append("file", current);

    const { response, context } = await runGuard(
      multipart(),
      uploadRequest(form),
    );

    expect(response.status).toBe(200);
    expect(context.form.note).toBe("keep");
    expect((context.form.previous as File).type).toBe(previous.type);
    expect((context.form.file as File).type).toBe(current.type);
    expect((context.form.file as File).name).toBe("b.json");
    expect(await (context.form.file as File).text()).toBe("new");
  });

  it("keeps Bun's default when the part declares no Content-Type", async () => {
    const boundary = "rossa-test-boundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="notes.txt"',
      "",
      "plain",
      `--${boundary}--`,
      "",
    ].join("\r\n");
    const makeRequest = () =>
      new Request("http://localhost/upload", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body,
      });

    const parsed = (await makeRequest().formData()).get("file") as File;
    const { response, context } = await runGuard(multipart(), makeRequest());

    expect(response.status).toBe(200);
    expect((context.form.file as File).type).toBe(parsed.type);
    expect(await (context.form.file as File).text()).toBe("plain");
  });
});
