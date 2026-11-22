import type { ErrorConfig } from "@/http/res";
import { ctx } from "@/http/ctx";

//-- Types

export type GuardFactoryHandler<
  TOptions = void,
  ExtraCfg = Record<string, any>,
> = (
  ctx: ctx,
  next: () => Promise<Response> | Response,
  options: TOptions,
  Config: ErrorConfig & ExtraCfg,
) => Promise<Response>;

export type GuardConfig = ErrorConfig & {
  id?: string | undefined;
};
/**
 * Per-call guard error configuration. Any field that is provided overrides the
 * factory default; omitted fields keep the default (or `400` for `code`).
 */
export type BaseConfig = ErrorConfig;

export type GuardReturnType = {
  (ctx: ctx, next: () => Promise<Response> | Response): Promise<Response>;
  _middlewareId: string;
  id: string;
};
// ---  ---------------------------------------------------------------

//-- Guard

/**
 * Creates a guard factory that merges a shared default error config with a
 * per-call override.
 *
 * The override wins for every field it defines (`code` included); omitted
 * fields fall back to the default, and `code` finally defaults to `400`.
 * `message` defaults to `"Request Failed"` and `headers` are shallow-merged.
 *
 * @param handler - Guard body invoked with the merged error config.
 * @param defaultConfig - Factory-wide id and default error config.
 * @returns A guard factory accepting `(options?, overrideConfig?)`.
 */
export function createGuard<
  TOptions = void,
  ExtraCfg = Record<string, unknown>,
>(
  handler: GuardFactoryHandler<TOptions, ExtraCfg>,
  defaultConfig: GuardConfig = {},
) {
  return function (
    options?: TOptions,
    overrideConfig: BaseConfig = {},
  ): GuardReturnType {
    //
    const { id: middlewareId, ...restDefault } = defaultConfig;

    // 1. Safely merge configurations. A per-call `code` wins over the factory
    // default, which falls back to 400.
    const mergedConfig: ErrorConfig & ExtraCfg = {
      ...restDefault,
      ...overrideConfig,
      code: overrideConfig.code ?? defaultConfig.code ?? 400,
      message:
        overrideConfig.message ?? defaultConfig.message ?? "Request Failed",
      headers: { ...defaultConfig.headers, ...overrideConfig.headers },
    } as ErrorConfig & ExtraCfg;

    if (
      overrideConfig.redirect !== undefined ||
      defaultConfig.redirect !== undefined
    ) {
      mergedConfig.redirect = overrideConfig.redirect ?? defaultConfig.redirect;
    }

    // 2. Create the standard runtime interceptor
    const interceptor = async (
      ctx: ctx,
      next: () => Promise<Response> | Response,
    ) => {
      return handler(ctx, next, options as TOptions, mergedConfig);
    };

    // 3. Attach identity metadata directly to the function object
    if (middlewareId) {
      interceptor._middlewareId = middlewareId;
      // Adding standard .id is also recommended for broader dedupe compatibility
      interceptor.id = middlewareId;
    }

    return interceptor;
  };
}
