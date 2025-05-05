import { ServerSide } from "authored";
import { obj } from "../@";
import { Runner } from "../runner";
import { getPath } from "../storage";

export class Render<T> {
  private constructor(
    public type: "yra" | "jwt",
    public render: T,
    public data: obj<any> = {},
  ) {}
  static async jwt(jwtSession: any) {
    return new Render<ServerSide>("jwt", jwtSession);
  }
}

export async function RENDER<T>(
  this: Runner,
  ctx: Render<T>,
  isErr: boolean = false,
) {
  const { type, render, data } = ctx;

  switch (type) {
    case "jwt":
      //
      return "jwt";
  }

  return "render";
}

async function checkFILE(this: Runner) {
  const { serverPath } = await getPath.call(this, "file");
  if (!serverPath) {
    // return await FOLDER.call(this);
  }
  return;
}
