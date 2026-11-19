export interface StreamPayload {
  /** Provides a recovery ID for automatic reconnection tracking. */
  id?: string | number;
  /** Contains the actual payload (must be the last field in the packet). */
  data: string | Record<string, any>;
  /** Names the event so the client can use addEventListener('name', ...). */
  event?: string;
  /** Tells the client how many milliseconds to wait before reconnecting (default is 3000ms). */
  retry?: number;
  /** Forcefully end and close the stream. */
  end?: boolean;
  /** State function to return the value as an argument in the next interval. */
  fn?: () => any;
}

export type StreamPushFn = (prevFnResult?: any) => StreamPayload;

export class SSEFormatter {
  static data(data: string | Record<string, any>): string {
    const payload =
      typeof data === "object" ? JSON.stringify(data) : String(data);
    return `data: ${payload}\n\n`;
  }

  static event(value: string): string {
    return `event: ${value}\n`;
  }

  static id(value: string | number): string {
    return `id: ${value}\n`;
  }

  static retry(value: number): string {
    return `retry: ${value}\n`;
  }
}

// Export the static formatter under your existing naming convention
export const stream = SSEFormatter;

export class eStream {
  private intervalIDs: ReturnType<typeof setInterval>[] = [];

  async push(
    ctrl: ReadableStreamDefaultController<any>,
    pushFn: StreamPushFn,
    interval: number = 2000,
  ): Promise<void> {
    let lastFnResult: any;

    // Enforce a minimum interval of 1000ms
    const safeInterval = Math.max(interval, 1000);

    const timer = setInterval(() => {
      try {
        const { id, retry, data, event, end, fn } = pushFn(lastFnResult);

        // Terminate Stream
        if (end) {
          this.close();
          try {
            ctrl.close();
          } catch (e) {}
          return;
        }

        // Assemble SSE Packet
        if (retry) {
          ctrl.enqueue(SSEFormatter.retry(Math.max(retry, 2000)));
        }

        if (id) {
          ctrl.enqueue(SSEFormatter.id(id));
        }

        if (event) {
          ctrl.enqueue(SSEFormatter.event(event));
        }

        ctrl.enqueue(SSEFormatter.data(data));

        // Evaluate state function for the next tick
        if (fn) {
          lastFnResult = fn();
        }
      } catch (error) {
        console.error("[eStream Error] Interval iteration failed:", error);
        this.close();
        try {
          ctrl.error(error);
        } catch (e) {}
      }
    }, safeInterval);

    this.intervalIDs.push(timer);
  }

  /**
   * Clears all running intervals associated with this stream instance.
   */
  close(): void {
    while (this.intervalIDs.length > 0) {
      const timer = this.intervalIDs.pop();
      if (timer) clearInterval(timer);
    }
  }
}
