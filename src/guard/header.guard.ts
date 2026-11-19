import type { ctx } from "@/http/ctx";
import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";

export type HeaderValidationRules = Record<
  string,
  (ctx: ctx, headName: string, value: string) => boolean
>;

/**
 * Requires named headers or validates header values with caller-provided rules.
 *
 * @param rules - Header names to require, or a map of names to validators.
 * @returns A guard factory that accepts header rules and optional error config.
 */
export const header = createGuard<HeaderValidationRules | string | string[]>(
  async (ctx, next, rules, errorConfig) => {
    const checker = (hname: string) => {
      return ctx.req.headers.get(hname);
    };

    if (rules) {
      let strRules: string[] | null = null;

      if (Array.isArray(rules)) {
        strRules = rules;
      } else if (typeof rules === "string") {
        strRules = [rules];
      }

      if (strRules) {
        for (const _hdCheck of strRules) {
          if (!checker(_hdCheck)) {
            return sendError({
              code: 401,
              message: `Missing required ${_hdCheck} property.`,
            });
          }
        }
      } else {
        for (const [headerName, validatorCallback] of Object.entries(rules)) {
          const hname = checker(headerName);
          if (!hname) {
            return sendError({
              code: 401,
              message: `Missing required ${headerName} property.`,
            });
          }

          if (!validatorCallback(ctx, headerName, hname)) {
            return sendError(errorConfig);
          }
        }
      }
    }
    return await next();
  },
  {
    code: 400,
    message: "Required headers are missing or invalid.",
  },
);
