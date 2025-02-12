import { getFile } from ".";
import { $$, parsePath } from "../../@";
import { responseBody, Runner } from "../../runner";
import { getPath } from "../../storage";

export async function FOLDER(this: Runner): Promise<responseBody> {
  const apath = this.path;
  const { parsed } = parsePath(this.path);
  const fpath = parsed.slice(0, -1).join("/");
  this.path = fpath;

  const { serverPath } = await getPath.call(this, "folder");

  if (!serverPath) return null;

  this.path = apath;
  return await getFile.call(this);
}
