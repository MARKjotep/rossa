/**
 * Converts FormData entries to a plain object, preserving repeated fields as
 * arrays instead of discarding earlier values.
 */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const values: Record<string, unknown> = Object.create(null);

  for (const [key, value] of formData.entries()) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      values[key] = value;
      continue;
    }

    const previous = values[key];
    values[key] = Array.isArray(previous) ? [...previous, value] : [previous, value];
  }

  return values;
}

/** MIME metadata declared by one part of a raw multipart body. */
interface MultipartPartMeta {
  name: string;
  isFile: boolean;
  type?: string;
}

/** Reads the boundary parameter from a `multipart/form-data` Content-Type. */
export function getMultipartBoundary(contentType: string): string | undefined {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  return boundary?.trim() || undefined;
}

/**
 * Reads the per-part headers of a raw multipart body.
 *
 * The body is decoded as latin1 so every byte maps to exactly one character;
 * only the ASCII header blocks are interpreted, while file payloads are merely
 * scanned for the boundary and never re-encoded.
 */
function readPartMeta(
  contentType: string,
  body: Uint8Array,
): MultipartPartMeta[] {
  const boundary = getMultipartBoundary(contentType);
  if (!boundary || body.byteLength === 0) return [];

  const raw = new TextDecoder("latin1").decode(body);
  const segments = raw.split(`--${boundary}`);
  const parts: MultipartPartMeta[] = [];

  for (let index = 1; index < segments.length; index += 1) {
    let segment = segments[index]!;
    if (segment.startsWith("--")) break; // closing delimiter
    if (segment.startsWith("\r\n")) segment = segment.slice(2);
    else if (segment.startsWith("\n")) segment = segment.slice(1);

    const headerEnd = /\r?\n\r?\n/.exec(segment);
    if (!headerEnd) continue;

    const headerBlock = segment.slice(0, headerEnd.index);
    const disposition =
      /content-disposition:[^\r\n]*/i.exec(headerBlock)?.[0] ?? "";
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    if (name === undefined) continue;

    const isFile = /\bfilename\*?=/i.test(disposition);
    const type = /^content-type:[ \t]*([^\r\n]+)$/im.exec(headerBlock)?.[1]?.trim();

    parts.push({
      name,
      isFile,
      ...(type ? { type } : {}),
    });
  }

  return parts;
}

/**
 * Rebuilds `FormData` files with the MIME types declared in a multipart body.
 *
 * Bun's `Request#formData()` (Bun 1.4.x) drops each part's `Content-Type`, so
 * uploaded `File` objects arrive with `type === ""`. Names, sizes, and bytes
 * are already correct; this helper restores only the declared type by matching
 * parts and entries in body order. Files without a declared type, and fields
 * that are not files, are copied through untouched.
 *
 * @param formData - The parsed form data to restore types on.
 * @param contentType - The request's `multipart/form-data` Content-Type header.
 * @param body - The raw request body the form data was parsed from.
 * @returns A form data instance whose files carry their uploaded types.
 */
export function restoreFileTypes(
  formData: FormData,
  contentType: string,
  body: Uint8Array,
): FormData {
  const parts = readPartMeta(contentType, body);
  if (parts.length === 0) return formData;

  const rebuilt = new FormData();
  let partIndex = 0;

  for (const [key, value] of formData.entries()) {
    // Entries follow body order; skip parts Bun may have dropped (nameless or
    // malformed) until the part that produced this entry is found.
    while (partIndex < parts.length && parts[partIndex]!.name !== key) {
      partIndex += 1;
    }
    const part = parts[partIndex];
    if (part) partIndex += 1;

    // Bun's FormData typings report `string` entries, but uploaded parts are
    // `File` instances at runtime.
    const entry: unknown = value;

    if (entry instanceof File && part?.isFile && part.type) {
      rebuilt.append(
        key,
        new File([entry], entry.name, {
          type: part.type,
          lastModified: entry.lastModified,
        }),
      );
      continue;
    }

    rebuilt.append(key, value);
  }

  return rebuilt;
}
