import type { methodsKeys } from "@/router/methods.router";
import type { Req } from "../req";
import type { Res } from "../res";
import { Heder } from "../headr";
import type { ServerSide } from "@/auth/session/server-side";

export class ctx<
  Args extends Record<string, string> = Record<string, string>,
  SessionType = ServerSide,
  BodyType = unknown,
> {
  public params: Args = {} as Args;

  /**
   * Custom header maker
   */
  public headr: Heder;
  public url: URL;
  public data: Record<string, any> = {};
  public jwtData: Record<string, any> = {};
  public session?: SessionType;
  public body?: BodyType;
  public query: Record<string, string | string[] | undefined> = {};
  public form: Record<string, any> = {};
  public readonly req: Req;
  public method: string = "GET";
  public methods: string[] = [];
  public clientDirectory: string = "";
  constructor(public readonly res: Res) {
    // Assuming Headers is a globally available class or imported
    this.headr = new Heder();
    this.req = res.req;
    this.url = this.req.url;
    // Extract method directly from request if possible
  }
}

// create additional ctx here? maybe sessionCtx? if used by session
