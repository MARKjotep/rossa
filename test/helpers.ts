import { ctx } from "../src/http/ctx";
import { Req } from "../src/http/req";
import { Res } from "../src/http/res";
import { StaticFileServer } from "../src/core/static-server";
import type { GuardReturnType } from "../src/guard/@/base.guard";
import { createServer } from "node:net";

const defaultStaticFiles = new StaticFileServer(process.cwd());

export function makeContext(
  request: Request,
  options: {
    server?: any;
    fileServer?: StaticFileServer;
    fileDetector?: (path: string) => boolean;
  } = {},
): ctx {
  const fileServer = options.fileServer ?? defaultStaticFiles;
  const fileDetector =
    options.fileDetector ?? fileServer.isFile.bind(fileServer);
  const req = new Req(request, options.server, fileDetector);
  return new ctx(new Res({ encoding: "none" }, req, fileServer, options.server));
}

export async function runGuard(
  guard: GuardReturnType,
  request: Request,
  context = makeContext(request),
) {
  let nextCalls = 0;
  const response = await guard(context, () => {
    nextCalls += 1;
    return new Response("next", { status: 200 });
  });
  return { response, context, nextCalls };
}

export function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  method = "POST",
): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export async function getFreePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => resolve());
  });
  const address = listener.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    throw new Error("Unable to reserve a local test port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}
