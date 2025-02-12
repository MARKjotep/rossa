import { ServerSide } from "authored";
import { JWT, responses } from "..";
import { $$ } from "../../@";
import { Runner } from "../../runner";
import { ContextString } from "./string";

export async function POST(this: Runner, ctx: responses) {
  //
  if (ctx instanceof ServerSide) {
    return JWT.call(this, ctx);
  }

  return ContextString.call(this, ctx);
}
