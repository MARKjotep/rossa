import { gzipSync, deflateSync, zstdCompressSync } from "bun";
import { brotliCompressSync } from "node:zlib";

// Note: Ensure your EncodingType aligns with these compression algorithms
// rather than string encodings like "utf8" or "hex".
export type ContentEncodingType = "gzip" | "deflate" | "br" | "zstd" | "none";

const ENCODINGS: ContentEncodingType[] = ["br", "gzip", "deflate", "zstd"];

export class Compressor {
  static negotiate(
    preferred: ContentEncodingType | undefined,
    acceptEncoding: string | null,
  ): ContentEncodingType | undefined {
    if (!preferred || preferred === "none" || !acceptEncoding) return undefined;
    const quality = new Map<string, number>();
    for (const part of acceptEncoding.split(",")) {
      const [name, ...parameters] = part.trim().toLowerCase().split(";");
      if (!name) continue;
      let q = 1;
      for (const parameter of parameters) {
        const match = parameter
          .trim()
          .match(/^q\s*=\s*(0(?:\.\d+)?|1(?:\.0+)?)$/);
        if (match) q = Number(match[1]);
      }
      quality.set(name, q);
    }
    const wildcard = quality.get("*");
    const candidates = ENCODINGS.map((encoding, order) => ({
      encoding,
      order,
      q: quality.get(encoding) ?? wildcard ?? 0,
    })).filter((candidate) => candidate.q > 0);
    candidates.sort((a, b) => b.q - a.q || a.order - b.order);
    if (quality.get(preferred) === 0)
      return candidates.find((item) => item.encoding !== preferred)?.encoding;
    return (
      candidates.find((item) => item.encoding === preferred)?.encoding ??
      candidates[0]?.encoding
    );
  }

  /**
   * Core compression logic.
   * Returns the compressed Uint8Array and the string for the Content-Encoding header.
   */
  static handle(
    data: Uint8Array,
    type?: ContentEncodingType | string,
  ): { payload: Uint8Array; encoding?: string } {
    if (!type || type === "none") {
      return { payload: data };
    }

    try {
      // Safely narrow the type to satisfy Bun's strict ArrayBuffer requirements
      const safeData = data as Uint8Array<ArrayBuffer>;

      switch (type) {
        case "gzip":
          return { payload: gzipSync(safeData), encoding: "gzip" };
        case "deflate":
          return { payload: deflateSync(safeData), encoding: "deflate" };
        case "br":
          return { payload: brotliCompressSync(safeData), encoding: "br" };
        case "zstd":
          return { payload: zstdCompressSync(safeData), encoding: "zstd" };
        default:
          return { payload: data };
      }
    } catch (error) {
      // Graceful fallback to uncompressed data if compression fails
      console.error(`[Compressor] Failed to compress using ${type}:`, error);
      return { payload: data };
    }
  }

  /**
   * Helper to safely ensure input is always a Uint8Array.
   */
  static toUint8(body: unknown): Uint8Array {
    // Handle empty bodies
    if (body === null || body === undefined) {
      return new Uint8Array();
    }

    // Handle existing buffers natively
    if (body instanceof Uint8Array) {
      return body;
    }
    if (body instanceof ArrayBuffer) {
      return new Uint8Array(body);
    }

    // Convert strings and JSON objects
    const str = typeof body === "string" ? body : JSON.stringify(body);
    return new TextEncoder().encode(str);
  }
}
