import { Refl } from "@ohmyqt/u";
import type { Methods } from "../methods.router";
import type { Websocket } from "@/wss/websocket.wss";

export const ROUTE_KEY = "rossa:route";

// --- Strict Metadata Interfaces ---
export interface ClassRouteMeta {
  basePath?: string;
  wss?: boolean;
}

/**
 * Router entry
 * @param basePath - /url/:hello
 * @returns
 */
export function route(basePath: string = "/") {
  return Refl.decorateClass<Methods, ClassRouteMeta>(ROUTE_KEY, () => ({
    basePath,
  }));
}

// --- Reserverd for websocket ---------------------------------------------------------------

/**
 * Router entry
 * @param basePath - /url/:hello
 * @returns
 */
export function wss(basePath: string = "/") {
  return Refl.decorateClass<Websocket, ClassRouteMeta>(ROUTE_KEY, () => ({
    basePath,
    wss: true,
  }));
}
