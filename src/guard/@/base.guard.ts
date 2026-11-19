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
export type BaseConfig = Omit<ErrorConfig, "code">;

export type GuardReturnType = {
  (ctx: ctx, next: () => Promise<Response> | Response): Promise<Response>;
  _middlewareId: string;
  id: string;
};
// ---  ---------------------------------------------------------------

//-- Guard

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

    // 1. Safely merge configurations
    const mergedConfig: ErrorConfig & ExtraCfg = {
      ...restDefault,
      ...overrideConfig,
      code: defaultConfig.code ?? 400,
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
