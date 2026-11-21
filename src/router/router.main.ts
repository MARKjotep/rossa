import { log, Refl } from "@ohmyqt/u";
import { route, ROUTE_KEY } from "./@";

import {
  Methods,
  METHODS,
  type handlerGuard,
  type methodGuards,
  type methodsKeys,
} from "./methods.router";
import { mergeGuards } from "@/guard/@/merge.guard";
import type { GuardReturnType } from "@/guard/@/base.guard";
import { GUARD_KEY } from "@/guard/@/@.guard";
import { Websocket } from "@/wss/websocket.wss";

//-- Types
type Class = new (...args: any[]) => any;

// --- Controller Interfaces ---
export interface WssBaseController {
  open?(ws: any): void;
  message(ws: any, message: string | Uint8Array): void;
  close?(ws: any, code: number, reason: string): void;
}
export interface WssRouteConfig {
  path: string;
  regex: RegExp;
  paramNames: string[];
  instance: typeof Websocket<{}>;
  guards: GuardReturnType[];
}

export interface HttpRouteConfig {
  path: string;
  regex: RegExp;
  controller: Class;
  methods: methodGuards;
  methodKeys: string[];
  paramNames: string[];
}

export interface HttpRouteMatch extends Partial<handlerGuard> {
  controller?: Class;
  methodKeys?: string[];
  params: Record<string, string>;
}

//-- Router Manager

export class RouterManager {
  protected globalBasePath: string;
  public httpRoutes: HttpRouteConfig[] = [];
  public wssRoutes: WssRouteConfig[] = [];
  protected globalGuards: any[] = [];
  private registeredSignatures = new Set<string>();

  // ---  ---------------------------------------------------------------

  constructor(globalBasePath: string = "") {
    this.globalBasePath = globalBasePath.startsWith("/")
      ? globalBasePath
      : `/${globalBasePath}`;

    if (this.globalBasePath === "/") {
      this.globalBasePath = "";
    }
  }
  // ---  ---------------------------------------------------------------
  // Register global guards
  use(...guards: GuardReturnType[]) {
    for (const midd of guards) {
      this.globalGuards.unshift(midd);
    }
  }

  // ---  ---------------------------------------------------------------

  private compiler(_path: string): { regex: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const regexString = _path.replace(/:([a-zA-Z0-9_]+)/g, (_, paramName) => {
      paramNames.push(paramName as string);
      return "([^/]+)";
    });
    return { regex: new RegExp(`^${regexString}\\/?$`), paramNames };
  }

  private checkSignature(
    _path: string,
    className: string,
    type: string = "http",
  ) {
    const signature = `${type}:${_path}`;

    if (this.registeredSignatures.has(signature)) {
      throw new Error(
        `[Router Error] Duplicate wss route collision detected: ${_path} ` +
          `in controller ${className}`,
      );
    }
    this.registeredSignatures.add(signature);
  }
  registerWSS(...ControllerClass: (typeof Websocket<{}>)[]) {
    for (const _cs of ControllerClass) {
      const classMeta = Refl.get.class(ROUTE_KEY, _cs);
      const classGuards = Refl.get.class(GUARD_KEY, _cs);

      if (!classMeta.length) return;

      for (const _rmeta of classMeta) {
        const controllerPath = _rmeta.basePath ?? "/";

        const fullBasePath =
          `${this.globalBasePath}${controllerPath}`
            .replace(/\/+/g, "/")
            .replace(/\/$/, "") || "/";

        this.checkSignature(fullBasePath, _cs.name, "wss");

        const { regex, paramNames } = this.compiler(fullBasePath);

        this.wssRoutes.push({
          path: fullBasePath,
          regex,
          paramNames,
          instance: _cs,
          guards: classGuards,
        });
      }
    }
  }

  register(...ControllerClass: (typeof Methods)[]) {
    // ---  ---------------------------------------------------------------
    for (const _cs of ControllerClass) {
      // check if the _cs is type of Websocket handler

      const classMeta = Refl.get.class(ROUTE_KEY, _cs);

      if (!classMeta.length) return;

      // --- k ---------------------------------------------------------------
      // class level Guards

      const routes: Record<
        string,
        Omit<HttpRouteConfig, "path" | "methods" | "methodKeys">
      > = {};

      for (const _rmeta of classMeta) {
        const controllerPath = _rmeta.basePath ?? "/";

        const fullBasePath =
          `${this.globalBasePath}${controllerPath}`
            .replace(/\/+/g, "/")
            .replace(/\/$/, "") || "/";

        this.checkSignature(fullBasePath, _cs.name);

        const { regex, paramNames } = this.compiler(fullBasePath);

        routes[fullBasePath] = {
          regex,
          paramNames,
          controller: _cs,
        };
      }

      const classInstance = new _cs() as Methods;

      // once cleard and no invalid signature, proceed in merging the guards
      const classGuards = Refl.get.class(GUARD_KEY, _cs);

      const methodKeys: Set<string> = new Set();
      const CMGuards: methodGuards = {};

      for (const methodName of METHODS) {
        const tfn = classInstance[methodName.toLowerCase()];

        if (typeof tfn !== "function") continue;

        CMGuards[methodName] = {
          guards: mergeGuards(classGuards, tfn),
          handler: tfn.bind(classInstance),
        };

        if (methodName !== "EVENT") methodKeys.add(methodName);
      }

      // ---  ---------------------------------------------------------------

      for (const [ky, cnt] of Object.entries(routes)) {
        this.httpRoutes.push({
          path: ky,
          ...cnt,
          methods: CMGuards,
          methodKeys: [...methodKeys],
        });
      }
    }
  }

  protected matchWSS(
    url: string,
  ): Partial<WssRouteConfig & { params: HttpRouteMatch["params"] }> {
    const cleanUrl = url.split("?")[0] ?? url;

    for (const route of this.wssRoutes) {
      const match = cleanUrl.match(route.regex);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, index) => {
        params[name] = match[index + 1] ?? "";
      });

      try {
        return {
          ...route,
          params,
        };
      } catch (error) {
        console.error(
          `WSS Route Execution Error [${route.instance.name}]:`,
          error,
        );
        return { params };
      }
    }

    return { params: {} };
  }
  protected match(method: methodsKeys, url: string): HttpRouteMatch {
    const cleanUrl = url.split("?")[0] ?? url;

    for (const route of this.httpRoutes) {
      const match = cleanUrl.match(route.regex);

      if (!match) continue;

      const rm = route.methods[method];

      if (!rm) continue;

      const params: Record<string, string> = {};

      route.paramNames.forEach((name, index) => {
        params[name] = match[index + 1] ?? "";
      });

      try {
        return {
          ...rm,
          methodKeys: route.methodKeys,
          controller: route.controller,
          params,
        };
      } catch (error) {
        console.error(
          `Route Execution Error [${route.controller.name}]:`,
          error,
        );
        return { params };
      }
    }

    return {
      params: {},
    };
  }

  // ---  ---------------------------------------------------------------

  public printRoutes(): void {
    console.log("--- Registered HTTP Routes ---");
    console.table(
      this.httpRoutes.map((r) => ({
        Methods: r.methodKeys.join(", "),
        Path: r.path,
        Type: "HTTP",
        // Handler: `${r.controller.name}.${r..name.replace("bound ", "")}()`,
      })),
    );

    console.log("\n--- Registered WSS Routes ---");
    console.table(
      this.wssRoutes.map((r) => ({
        Path: r.path,
        Controller: r.instance.constructor.name,
      })),
    );
  }

  /** Returns registered HTTP paths, including the base path, with parameter colons removed. */
  getPaths(): string[] {
    return this.httpRoutes.map(({ path }) =>
      path.replace(/:([a-zA-Z0-9_]+)/g, "$1"),
    );
  }
}

//-- _uRoute class

class _uRoute {}

const _R: Omit<typeof _uRoute, "prototype"> = _uRoute;
// ---  ---------------------------------------------------------------
