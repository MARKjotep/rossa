import { sendError } from "@/http/res";

/**
 * Default request-body cap shared by the body-parsing guards.
 *
 * Mirrors `json()`'s limit so every body parser accepts the same payload size
 * (1 MiB) unless a guard is configured with an explicit `maxSize`.
 */
export const DEFAULT_MAX_SIZE = 1 * 1024 * 1024;

/**
 * Resolves the effective body cap.
 *
 * @param maxSize - Explicit cap in bytes; ignored when absent or not positive.
 * @returns The explicit cap, or {@link DEFAULT_MAX_SIZE}.
 */
export function resolveMaxSize(maxSize?: number): number {
  return typeof maxSize === "number" && maxSize > 0
    ? maxSize
    : DEFAULT_MAX_SIZE;
}

/**
 * Builds the `413` rejection used for over-limit bodies.
 *
 * The status and message match `json()`'s over-limit response exactly so a
 * client sees one shape regardless of which body parser rejected the payload.
 *
 * @param maxAllowedBytes - The cap that was exceeded, in bytes.
 * @returns The `413` error `Response`.
 */
export function payloadTooLarge(maxAllowedBytes: number): Response {
  return sendError({
    code: 413,
    message: `Payload exceeded maximum allowed size of ${maxAllowedBytes / 1024} KB`,
  });
}

/**
 * Rejects an over-limit request using its declared `Content-Length` before the
 * body is read, mirroring `json()`'s header validation.
 *
 * @param headers - The request headers to inspect.
 * @param maxAllowedBytes - The cap to enforce, in bytes.
 * @returns A `400`/`413` error `Response` when the request must be rejected,
 * otherwise `null`.
 */
export function checkContentLength(
  headers: Headers,
  maxAllowedBytes: number,
): Response | null {
  const contentLengthHeader = headers.get("content-length");
  if (contentLengthHeader === null) return null;

  if (!/^\d+$/.test(contentLengthHeader)) {
    return sendError({
      code: 400,
      message: "Invalid Content-Length header",
    });
  }

  const contentLength = Number(contentLengthHeader);
  if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
    return sendError({
      code: 400,
      message: "Invalid Content-Length header",
    });
  }

  if (contentLength > maxAllowedBytes) return payloadTooLarge(maxAllowedBytes);

  return null;
}

/**
 * Reads the request body, enforcing the cap on the bytes actually received so
 * an understated `Content-Length` (or a chunked body) cannot bypass it.
 *
 * Reading stops as soon as the cap is crossed, so an oversized payload is
 * rejected without being fully buffered.
 *
 * @param request - The request whose body is read.
 * @param maxAllowedBytes - The cap to enforce, in bytes.
 * @returns The body bytes, or a `413` error `Response` when over the cap.
 */
export async function readBodyWithinLimit(
  request: Request,
  maxAllowedBytes: number,
): Promise<Uint8Array<ArrayBuffer> | Response> {
  if (!request.body) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxAllowedBytes) {
      await reader.cancel().catch(() => {});
      return payloadTooLarge(maxAllowedBytes);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}
