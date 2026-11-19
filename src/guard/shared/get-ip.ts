import type { ctx } from "@/http/ctx";

export const getIP = (ctx: ctx) => {
  const server = ctx.req.server;
  if (server) {
    // Never trust a client-supplied forwarding header when the request reached
    // this server directly. Reverse-proxy support needs an explicit trust policy.
    return server.requestIP(ctx.req.request)?.address ?? "";
  }

  // Rossa.test() has no Bun.Server from which to obtain a remote address.
  return ctx.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "127.0.0.1";
};
