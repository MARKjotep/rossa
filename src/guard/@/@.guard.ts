import "reflect-metadata";

import { Refl } from "@ohmyqt/u";
import type { GuardReturnType } from "./base.guard";
import type { Methods } from "@/router";

export const GUARD_KEY = "rossa:guard";

export type DecoratorKind =
  "class" | "method" | "getter" | "setter" | "field" | "accessor";

export function use(...middlewares: GuardReturnType[]) {
  //
  return Refl.decorateArray(GUARD_KEY, ["class", "method"], middlewares);
}
