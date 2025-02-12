import { yveOptions } from "..";
import { $$, isArr, isStr, oAss, obj } from "../../@";
import { pathConfig, wssConfig, setPath } from "../../storage";
import { websocket } from "../../wss";
import { response } from "../../response";

export class Formula {
  apt: string;
  files: (...file: ([string, pathConfig] | string)[]) => void;
  _statics?: obj<Response>;
  statics: (statics?: obj<Response>) => void;
  constructor(
    public dir: string = ".",
    options: yveOptions = {},
  ) {
    const { dir: _dir, appDir } = options;
    if (_dir) this.dir = _dir;
    this.apt = this.dir + "/" + (appDir ?? "app");

    this.files = (...file: ([string, pathConfig] | string)[]) => {
      //
      file.forEach((ff) => {
        const [path, config] = getFFConfig(ff);
        const fs = path.replace(/^\.+/, "");
        const _path = fs.startsWith("/") ? fs : "/" + fs;
        setPath("file", _path, config, this.apt)();
      });
    };

    this.statics = (statics: obj<Response> = {}) => {
      if (!this._statics) {
        this._statics = {};
      }
      oAss(this._statics, statics);
    };
  }
  /** --------------------
   * string | int | float | file | uuid
   * - /url/\<string:hell>
   */
  route(path: string) {
    return setPath<typeof response>("path", path);
  }
  wss(path: string, config: wssConfig = {}) {
    return setPath<typeof websocket>("wss", path, config);
  }
  error(...codes: number[]) {
    return <T extends typeof response>(f?: T) => {
      if (codes.length) {
        codes.forEach((_c) => {
          setPath<typeof response>("error", _c.toString(), {})(f);
        });
      } else {
        setPath<typeof response>("error", "404", {})(f);
      }

      return f;
    };
  }
  folders(...folder: ([string, { requireSession?: boolean }] | string)[]) {
    folder.forEach((ff) => {
      setPath("folder", ...getFFConfig(ff))();
    });
  }
  redirect(url: string, headers: obj<string> = {}) {
    return new Response("", {
      status: 302,
      headers: new Headers({ ...headers, Location: url }),
    });
  }
}

const getFFConfig = (
  ff: string | [string, pathConfig],
): [string, pathConfig] => {
  const _isStr = isStr(ff);
  return [_isStr ? (ff as string) : ff[0], _isStr ? {} : ff[1]];
};
