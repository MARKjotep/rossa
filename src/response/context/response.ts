import { Runner } from "../../runner";

export async function RESPONSE(this: Runner, ctx: Response) {
  this.status = ctx.status;
  this.header = ctx.headers.toJSON();
  const CARR = await ctx.arrayBuffer();
  return CARR;
}
