import { describe, expect, it } from "bun:test";
import { validateUrl } from "../../src/guard/url.guard";
import { runGuard } from "../helpers";

const fetchPath = (path: string, guard = validateUrl()) =>
  runGuard(guard, new Request(`http://localhost${path}`));

describe("validateUrl query-string inspection", () => {
  it("rejects traversal markers in the query under default config", async () => {
    const plain = await fetchPath("/guarded?x=../etc");
    expect(plain.response.status).toBe(400);

    const slashFirst = await fetchPath("/guarded?next=/../admin");
    expect(slashFirst.response.status).toBe(400);

    const encoded = await fetchPath("/guarded?x=%2e%2e%2fetc");
    expect(encoded.response.status).toBe(400);

    const doubleEncoded = await fetchPath("/guarded?x=%252e%252e%252fetc");
    expect(doubleEncoded.response.status).toBe(400);

    const backslash = await fetchPath("/guarded?x=..%5Cwindows");
    expect(backslash.response.status).toBe(400);
  });

  it("keeps normal and empty query strings working", async () => {
    const normal = await fetchPath("/guarded?page=2&q=hello%20world");
    expect(normal.response.status).toBe(200);

    const empty = await fetchPath("/guarded");
    expect(empty.response.status).toBe(200);

    const emptyQuery = await fetchPath("/guarded?");
    expect(emptyQuery.response.status).toBe(200);

    const dotted = await fetchPath("/guarded?version=1.2.3");
    expect(dotted.response.status).toBe(200);
  });

  it("keeps NUL, disallowed-key, and over-length rejections intact", async () => {
    const nul = await fetchPath("/guarded?x=..%00");
    expect(nul.response.status).toBe(400);

    const disallowed = await runGuard(
      validateUrl({ disallowedKeys: ["debug"] }),
      new Request("http://localhost/guarded?debug=1"),
    );
    expect(disallowed.response.status).toBe(400);

    const tooLong = await runGuard(
      validateUrl({ maxUrlLength: 30 }),
      new Request("http://localhost/guarded?x=../etc"),
    );
    expect(tooLong.response.status).toBe(414);
  });
});
