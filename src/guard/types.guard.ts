import type { ctx } from "@/http/ctx";

/** Function signature for a guard that receives request context and continues the pipeline. */
export type GlobalGuard = (
  ctx: ctx,
  next: () => Promise<Response>,
) => Promise<Response>;
