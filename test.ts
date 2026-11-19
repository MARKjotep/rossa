import {
  Field,
  Methods,
  Rossa,
  Websocket,
  contentType,
  cors,
  logger,
  loggerFN,
  route,
  smartCache,
  use,
  wss,
} from "./src/index";
import type { ctx, wssMessage } from "./src/index";

const app = new Rossa({ Encoding: "none" });

type MyConfig = {
  shop: {
    id: string;
  };
  lark: {
    token: string;
  };
};

Field.register<MyConfig>({
  shop: { id: "2" },
  lark: { token: "123" },
});

const SCL = Field.use<MyConfig["shop"]>("shop");

@route("/")
@use(logger())
class HomeController extends Methods {
  @SCL.id _name!: string;

  @use(cors({ origin: "http://localhost:3000" }))
  get({ res }: ctx): Response {
    return res.text("k dotty");
  }

  @use(contentType("application/json"))
  post({ res }: ctx): Response {
    return res.json({ cool: 2 });
  }

  // @use(
  //   loggerFN(({ timestamp, method }) => `${method} ${timestamp}: event test`),
  // )
  // event({ res }: ctx): Response {
  //   return res.event.readableStream(() => ({ data: "event test" }));
  // }
}

@route("/:file")
class StaticController extends Methods {
  get({ req, res }: ctx): Promise<Response> | Response {
    if (req.isFile) return res.fileServer();
    return res.error(405, "invalid request");
  }
}

@wss("/")
@use(logger())
class SocketController extends Websocket {
  open(): void {}
  message({ text, json, topic }: wssMessage): void {}
  close(code: number, reason: string): void {}
}

app.use(smartCache({ ttlMs: 30_000 }));
app.register(HomeController, StaticController);
app.registerWSS(SocketController);

const response = await app.test(
  new Request("http://localhost:3000/", { method: "GET" }),
);
//
console.log(response.status, await response.text());

// Start a live Bun server instead of calling app.test:
// app.serve({ port: 3000, hostname: "localhost" });
