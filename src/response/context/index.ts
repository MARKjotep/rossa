import { response, responses } from "..";
import { setSession } from "../../session";
import { Runner } from "../../runner";
import { RESPONSE } from "./response";
import { POST } from "./post";
import { Render, RENDER } from "../../render";
import { ContextString } from "./string";
import { isNumber, oLen } from "../../@";

export { ContextString } from "./string";

function noCTX(this: Runner, status?: number) {
  this.status = status ?? 204;
  return null;
}

async function fResponse(this: Runner, F: response) {
  const { header, status, __session } = F;

  if (oLen(header)) this.header = header;

  if (status) this.status = status;

  __session && (await setSession(__session, this.headers));
}

export async function CTX(
  this: Runner,
  F: response,
  ctx: responses,
  isErr: boolean = false,
) {
  //

  if (!ctx) return noCTX.call(this, F.status);

  if (typeof ctx === "object" && "error" in ctx && isNumber(ctx.error)) {
    this.status = ctx.error as number;
    return null;
  }

  await fResponse.call(this, F);

  if (ctx instanceof Response) return await RESPONSE.call(this, ctx);

  if (ctx instanceof Render) {
    if (F.status) this.status = F.status;

    return await RENDER.call(this, ctx, isErr);
  }

  switch (this.request.method) {
    case "post":
      return POST.call(this, ctx);
    default:
      return ContextString.call(this, ctx);
  }
}
