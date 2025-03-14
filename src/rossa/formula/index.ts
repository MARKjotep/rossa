import { yveOptions } from "..";
import { $$, addBASE, isArr, isStr, oAss, obj } from "../../@";
import { pathConfig, wssConfig, setPath } from "../../storage";
import { websocket } from "../../wss";
import { response } from "../../response";

class routeCFG {
  declare files: (...file: ([string, pathConfig] | string)[]) => void;
  declare statics: (statics?: obj<Response>) => void;
  /** --------------------
   * string | int | float | file | uuid
   * - /url/\<string:hell>
   */
  declare route: (
    path: string,
  ) => <T extends typeof response>(f?: T | undefined) => T | undefined;

  declare wss: (
    path: string,
    config: wssConfig,
  ) => <T extends typeof websocket>(f?: T | undefined) => T | undefined;

  declare error: (
    ...codes: number[]
  ) => <T extends typeof response>(f?: T | undefined) => T | undefined;

  declare folders: (
    ...folder: (
      | [
          string,
          {
            requireSession?: boolean;
          },
        ]
      | string
    )[]
  ) => void;

  declare redirect: (url: string, headers?: obj<string>) => Response;
}

export class Formula extends routeCFG {
  apt: string;
  base: string;
  _statics?: obj<Response>;
  constructor(
    public dir: string = ".",
    options: yveOptions = {},
  ) {
    super();
    const { root: _dir, base, appDir } = options;

    if (_dir) this.dir = _dir;
    this.apt = this.dir + "/" + (appDir ?? "client");
    this.base = base ?? "";

    this.files = (...file: ([string, pathConfig] | string)[]) => {
      //
      file.forEach((ff) => {
        const [path, config] = foderCFG.call(this, ff);
        const fs = path.replace(/^\.+/, "");
        const _path = fs.startsWith("/") ? fs : "/" + fs;
        setPath("file", _path, config, this.apt)();
      });
    };

    this.folders = (
      ...folder: ([string, { requireSession?: boolean }] | string)[]
    ) => {
      folder.forEach((ff) => {
        setPath("folder", ...foderCFG.call(this, ff))();
      });
    };

    this.statics = (statics: obj<Response> = {}) => {
      if (!this._statics) {
        this._statics = {};
      }
      oAss(this._statics, statics);
    };

    this.route = (path: string) => {
      return setPath<typeof response>("path", this._base(path));
    };

    this.wss = (path: string, config: wssConfig = {}) => {
      return setPath<typeof websocket>("wss", this._base(path), config);
    };

    this.error = (...codes: number[]) => {
      return <T extends typeof response>(f?: T) => {
        if (codes.length) {
          codes.forEach((_c) => {
            setPath<typeof response>("error", this._base(_c.toString()), {})(f);
          });
        } else {
          setPath<typeof response>("error", this._base("404"), {})(f);
        }

        return f;
      };
    };

    this.redirect = (url: string, headers: obj<string> = {}) => {
      return new Response("", {
        status: 302,
        headers: new Headers({ ...headers, Location: this._base(url) }),
      });
    };
  }

  protected _base(str: string) {
    return addBASE(this.base, str);
  }
}

function foderCFG(
  this: Formula,
  ff: string | [string, pathConfig],
): [string, pathConfig] {
  const _isStr = isStr(ff);

  return [_isStr ? this._base(ff) : this._base(ff[0]), _isStr ? {} : ff[1]];
}
