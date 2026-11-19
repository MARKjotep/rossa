import { createGuard } from "./@/base.guard";
import { sendError } from "@/http/res";

/**
 * Stops waiting for downstream work after the configured number of milliseconds.
 *
 * @param ms - Maximum time to wait for downstream guards and handlers.
 * @returns A guard factory that accepts a timeout and optional error config.
 */
export const timeout = createGuard<number>(
  async (ctx, next, ms, errorConfig) => {
    let timer: Timer | undefined;
    const timeoutPromise = new Promise<Response>((resolve) => {
      timer = setTimeout(() => resolve(sendError(errorConfig)), ms);
    });

    try {
      return await Promise.race([next(), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
  { id: "timeout-guard", code: 408, message: "Request Timeout" },
);
