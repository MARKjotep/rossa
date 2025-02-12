import { response } from "..";
import { obj } from "../../@";
import { responseBody, Runner } from "../../runner";

export class eStream {
  intervalID: Timer[] = [];
  constructor(public ctrl?: ReadableStreamDefaultController<any>) {}
  push(
    fn: () => {
      id: string | number;
      data: string | Record<string, string>;
      event?: string;
      retry?: number;
      end?: boolean;
    },
    interval: number | 1000 = 2000,
  ) {
    if (this.ctrl) {
      const intervalID = setInterval(
        () => {
          const { id, retry, data, event, end } = fn();
          if (this.ctrl) {
            let _data = end ? "end" : data;
            if (retry) {
              let rt = retry > 2000 ? retry : 2000;
              this.ctrl.enqueue(`retry: ${rt}\\n`);
            }
            this.ctrl.enqueue(`id: ${id}\\n`);
            event && this.ctrl.enqueue(`event: ${event}\\n`);
            if (typeof _data == "object") {
              this.ctrl.enqueue("data: " + JSON.stringify(_data) + "\\n\\\n");
            } else {
              this.ctrl.enqueue(
                "data: " + JSON.stringify({ message: _data }) + "\\n\\n",
              );
            }
            end && this.close();
          }
        },
        interval > 1000 ? interval : 1000,
      );
      this.intervalID.push(intervalID);
    }
  }
  close() {
    if (this.intervalID.length) {
      this.intervalID.forEach((ff) => {
        clearInterval(ff);
      });
      this.intervalID = [];
    }
    this.ctrl?.close();
  }
}

export async function ESTREAM(
  this: Runner,
  F: response,
  args: obj<string>,
  proto: (args: obj<string>) => any,
): Promise<responseBody> {
  this.status = 200;
  this.header = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  };

  //

  const req = this.request;

  const stream = new ReadableStream({
    async start(controller) {
      F.stream = new eStream(controller);

      await proto.call(F, args);

      req.signal.addEventListener("abort", () => {
        F.stream?.close();
        if (F.stream?.intervalID.length) {
          controller.close();
        }
      });
    },
  });

  const initialCtx = await proto.call(F, args);

  if (typeof initialCtx === "object" && "error" in initialCtx) {
    this.status = initialCtx.error;
    return null;
  }

  return stream;
}
