import { file } from "bun";
import { log, MinStorage, oVals, SymStorage } from "../@";
import { authorized, ResponseSession } from "../session";
import { Runner } from "../runner";
import { response } from "../response";
import { websocket } from "../wss";

export interface pathConfig {
  requireSession?: boolean;
  preload?: boolean;
}
export interface wssConfig {
  broadcast?: boolean;
  maxClient?: number;
  requireSession?: boolean;
}

const METHODS: string[] = ["GET", "POST", "PUT", "DELETE", "OPTIONS"];

class ServerPath extends MinStorage {
  private _class?: typeof response | typeof websocket;
  options: string = "";
  bytes?: Uint8Array;
  fileType: string = "text/plain";
  fileSize: number = 0;
  constructor(
    path: string,
    public config: wssConfig | pathConfig = {},
  ) {
    super(path);
  }
  set serverClass(rsp: typeof response) {
    this._class = rsp;
    this.options = METHODS.filter(
      (method) => rsp.prototype[method.toLowerCase()],
    ).join(", ");
  }
  get serverClass(): typeof response | typeof websocket | undefined {
    return this._class;
  }
  async loadBytes(basePath: string = ".") {
    if (!(this.config as pathConfig).preload) return;
    try {
      log.i = this.path;
      const PT = this.path.startsWith("/") ? this.path : "/" + this.path;
      const fl = file(basePath + this.path);
      this.fileType = fl.type;
      this.bytes = await fl.bytes();
      this.fileSize = this.bytes.byteLength;
    } catch {
      throw `error: can't preload ${this.path}. File not found.`;
    }
  }
}

export type storageType = "file" | "wss" | "path" | "folder" | "error";

const SYMAP = {
  path: Symbol("path"),
  wss: Symbol("wss"),
  file: Symbol("file"),
  folder: Symbol("folder"),
  error: Symbol("error"),
};

const STORAGE = new SymStorage<ServerPath>(...oVals(SYMAP));

const getStorage = (type: storageType) => {
  const symbol = SYMAP[type];
  if (!symbol) throw new Error("Invalid storage type");
  return STORAGE[symbol];
};

export const setPath = <Q>(
  type: storageType,
  path: string,
  config: wssConfig = {},
  basePath?: string,
) => {
  //
  return <T extends Q>(f?: T) => {
    const _SP = new ServerPath(path, config);
    if (f) _SP.serverClass = f as any;
    if (type === "file") _SP.loadBytes(basePath);
    getStorage(type).set(_SP);
    return f;
  };
};

interface serverPath {
  serverPath?: ServerPath;
  args: Record<string, string>;
  session?: ResponseSession;
}

const arg = {
  args: {},
};

export async function getPath(
  this: Runner,
  type: storageType,
): Promise<serverPath> {
  if (type === "folder") {
  } else {
  }
  const [serverPath, args] = getStorage(type).get(this.path);
  if (!serverPath) {
    //
    return arg;
  }

  const { requireSession } = serverPath.config;

  let session: ResponseSession | undefined = undefined;

  if (requireSession) {
    session = await authorized(await this.request.authgroup(), args);
    if (!session) return arg;
  }

  //
  return { serverPath, args, session };
}
