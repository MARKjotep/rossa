import { responses } from "..";
import { log } from "../../@";
import { Runner } from "../../runner";

export function ContextString(
  this: Runner,
  ctx: responses,
  status?: number,
): string {
  this.status = status || 200;

  if (typeof ctx === "object") {
    this.type = "application/json";
    return JSON.stringify(ctx);
  }

  this.type = "text/html";
  return String(ctx);
}
