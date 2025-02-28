import {
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  watch,
  WatchEventType,
} from "node:fs";
import path from "node:path";
import { isDir } from "../@/bun";
import { $$, isFN, ngify, oFItems, oItems, oLen } from "../@";
import { BunPlugin, file } from "bun";

export class Builder {
  dir: string = "./src";
  out: string = "./app";
  files: string[];
  external: string[];
  drop: string[];
  target: string;
  define: Record<string, any>;
  exclude: string[] = ["index.html"];
  hashAsset: boolean;
  plugins: BunPlugin[] = [];
  private clearing?: boolean = false;
  constructor({
    files,
    target = "browser",
    define = {},
    hashAsset,
    external = [],
    drop = [],
    plugins = [],
  }: {
    files: string[];
    target?: "browser" | "bun";
    define?: Record<string, any>;
    hashAsset?: boolean;
    external?: string[];
    drop?: string[];
    plugins?: BunPlugin[];
  }) {
    this.files = files.map((m) => (this.dir + "/" + m).replaceAll("//", "/"));
    this.hashAsset = hashAsset == undefined ? true : hashAsset;
    this.external = external;
    this.drop = drop;
    this.plugins = plugins;
    isDir(this.out);
    this.target = target;

    this.define = define;
  }
  clear(c: { exclude: string[] } = { exclude: [] }) {
    //
    c.exclude.length && this.exclude.push(...c.exclude);

    this.clearing = true;

    const recurse = (_PATH: string) => {
      const dirs = readdirSync(_PATH);
      if (dirs.length == 0) {
        rmSync(_PATH, { recursive: true });
        return;
      }
      dirs.forEach((ff) => {
        if (ff.startsWith(".") || this.exclude.includes(ff)) return;
        const _path = path.join(_PATH, ff);
        if (statSync(_path).isDirectory()) {
          recurse(_path);
        } else {
          unlinkSync(_path);
        }
      });
    };

    recurse(this.out);

    return this;
  }
  build() {
    const asset = `[dir]/[name]${this.hashAsset ? "-[hash]" : ""}.[ext]`;

    if (this.files.length) {
      Bun.build({
        entrypoints: this.files,
        outdir: this.out,
        splitting: true,
        minify: {
          identifiers: true,
          whitespace: true,
          syntax: true,
        },
        target: (this.target as "browser") ?? "browser",
        naming: {
          chunk: "[dir]/[name]-[hash].[ext]",
          entry: "[dir]/[name].[ext]",
          asset,
        },
        define: {
          ...ProcessDefine(this.define),
        },
        loader: {
          ".css": "file",
        },
        external: this.external,
        drop: this.drop,
        plugins: this.plugins,
      })
        .then((e) => {
          // e.outputs.forEach(async (ba) => {
          //   if (ba.type.includes("javascript")) {
          //     const FT = await ba.text();
          //     $$.p = FT;
          //     // $$.p = extractClassesAlt(FT);
          //   }
          // });
          //
          if (e.success) {
            const dt = new Date().toLocaleTimeString();
            $$.p = `builder @ ${dt}`;
          } else {
            $$.p = e.logs;
          }
        })
        .catch((e) => {
          $$.p = e;
        });
    }

    return this;
  }
  watch(fn?: (event: WatchEventType, filename: string | null) => void) {
    const watcher = watch(
      this.dir,
      { recursive: true },
      async (event, filename) => {
        if (filename && filename.endsWith("tsx")) {
          this.clearing && this.clear();
          try {
            this.build();
          } catch (e) {
            console.error(e);
          }
        }
        fn?.(event, filename);
      },
    );

    process.on("SIGINT", () => {
      console.log("\nwatcher closed...");
      watcher.close();
      process.exit(0);
    });
  }
}

const ProcessDefine = (define: Record<string, any>) => {
  return oFItems(
    oItems(define).map(([k, v]) => {
      let lv = v;
      if (isFN(v)) {
        lv = v();
      }
      return [k, ngify(lv)];
    }),
  );
};
