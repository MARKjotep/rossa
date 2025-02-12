import { BunFile, file } from "bun";
import { getPath } from "../../storage";
import { $$, getByteRange, isArraybuff } from "../../@";
import { responseBody, Runner } from "../../runner";
import { FOLDER } from "./folder";

/*
-------------------------
FILE
-------------------------
*/

export async function FILE(this: Runner): Promise<responseBody> {
  const { serverPath } = await getPath.call(this, "file");
  if (!serverPath) {
    return await FOLDER.call(this);
  }

  if (serverPath.bytes) {
    return loadBytes.call(this, serverPath.bytes, serverPath.fileSize);
  }

  return await getFile.call(this);
}

export async function getFile(this: Runner) {
  try {
    const FL = file(this.dir + this.path);

    if (FL.type.startsWith("video/")) {
      return loadBytes.call(this, FL, FL.size);
    } else {
      const bytes = await FL.bytes();
      return loadBytes.call(this, bytes, bytes.byteLength);
    }
  } catch {
    return `${this.path} file not found.`;
  }
}

export function loadBytes(
  this: Runner,
  bytes: Uint8Array | BunFile,
  size: number,
) {
  const { type, range } = this.request;

  this.type = type;
  this.status = 206;

  if (!range) {
    this.header = {
      "Cache-Control": "max-age=86400, must-revalidate",
    };
    return isArraybuff(bytes) ? this.compress("gzip", bytes) : bytes;
  }
  const [start, end, total] = getByteRange(size, range);
  this.header = {
    "Content-Range": `bytes ${start}-${end}/${total}`,
    "Content-Length": size.toString(),
  };

  return bytes.slice(start, end + 1);
}
