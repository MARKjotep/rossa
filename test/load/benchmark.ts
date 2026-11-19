import { Rossa, Websocket, wss } from "../../src/index";
import type { TopicPublishStatus, wssMessage } from "../../src/index";
import { getFreePort } from "../helpers";

const clientsCount = positiveInt(process.env.BENCH_CLIENTS, 20);
const durationSeconds = positiveInt(process.env.BENCH_DURATION_SECONDS, 10);
const messagesPerSecond = positiveInt(process.env.BENCH_MESSAGES_PER_SECOND, 50);
const waitForDeliveryMs = positiveInt(process.env.BENCH_DELIVERY_TIMEOUT_MS, 15_000);
const backpressureLimit = positiveInt(process.env.BENCH_BACKPRESSURE_LIMIT, 1_048_576);
const targetUrl = process.env.BENCH_URL;
const plannedMessages = durationSeconds * messagesPerSecond;

if (clientsCount < 2) {
  throw new Error("BENCH_CLIENTS must be at least 2 to measure room fan-out");
}

const publishCounts: Record<TopicPublishStatus, number> = {
  sent: 0,
  backpressured: 0,
  dropped: 0,
  oversize: 0,
};

@wss("/benchmark")
class BenchmarkSocket extends Websocket {
  override open() {
    this.manager.subscribe("benchmark:shared-room");
  }

  override message({ json }: wssMessage) {
    const results = this.manager.broadcast(["benchmark:shared-room"], json);
    for (const result of results) publishCounts[result.status] += 1;
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Expected a positive integer, got ${raw}`);
  }
  return value;
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? sorted.at(-1)!;
}

const app = new Rossa({ Encoding: "none" });
app.registerWSS(BenchmarkSocket);
const server = targetUrl
  ? undefined
  : app.serve(
      { hostname: "127.0.0.1", port: await getFreePort() },
      {
        maxPayloadLength: 64 * 1024,
        backpressureLimit,
        closeOnBackpressureLimit: true,
        perMessageDeflate: false,
        messageRateLimit: {
          max: messagesPerSecond + 10,
          windowMs: 1_000,
        },
      },
    );
const endpoint = targetUrl ?? `ws://127.0.0.1:${server!.port}/benchmark`;
if (targetUrl && !/^wss?:\/\//.test(targetUrl)) {
  throw new Error("BENCH_URL must be a ws:// or wss:// WebSocket URL");
}

const sockets: WebSocket[] = [];
const seen = new Set<number>();
const latenciesMs: number[] = [];
let receivedDeliveries = 0;
let resolveDelivery: (() => void) | undefined;
const allDeliveries = new Promise<void>((resolve) => {
  resolveDelivery = resolve;
});

try {
  const clients = await Promise.all(
    Array.from({ length: clientsCount }, async () => {
      const socket = new WebSocket(endpoint);
      sockets.push(socket);
      await waitForOpen(socket);
      return socket;
    }),
  );

  const expectedDeliveries = plannedMessages * (clientsCount - 1);
  for (const socket of clients) {
    socket.addEventListener("message", (event) => {
      let payload: { id?: number; sentAt?: number };
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof payload.id !== "number" || typeof payload.sentAt !== "number") return;
      receivedDeliveries += 1;
      if (!seen.has(payload.id)) {
        seen.add(payload.id);
        latenciesMs.push(performance.now() - payload.sentAt);
      }
      if (receivedDeliveries >= expectedDeliveries) resolveDelivery?.();
    });
  }

  const rssBefore = process.memoryUsage().rss;
  const sendStartedAt = performance.now();
  const delayMs = 1_000 / messagesPerSecond;
  for (let id = 0; id < plannedMessages; id += 1) {
    clients[id % clients.length]!.send(JSON.stringify({ id, sentAt: performance.now() }));
    await Bun.sleep(delayMs);
  }

  let deliveryTimeoutId: ReturnType<typeof setTimeout> | undefined;
  const deliveryResult = await Promise.race([
    allDeliveries.then(() => "complete" as const),
    new Promise<"timeout">((resolve) => {
      deliveryTimeoutId = setTimeout(() => resolve("timeout"), waitForDeliveryMs);
    }),
  ]);
  if (deliveryTimeoutId) clearTimeout(deliveryTimeoutId);
  const elapsedSeconds = (performance.now() - sendStartedAt) / 1_000;
  const rssAfter = process.memoryUsage().rss;
  const report = {
    workload: {
      target: targetUrl ? "external" : "local",
      clients: clientsCount,
      durationSeconds,
      targetMessagesPerSecond: messagesPerSecond,
      sentMessages: plannedMessages,
      expectedDeliveries,
    },
    results: {
      deliveryStatus: deliveryResult,
      receivedDeliveries,
      deliveryRatio: expectedDeliveries === 0 ? 1 : receivedDeliveries / expectedDeliveries,
      uniqueMessagesReceived: seen.size,
      elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
      observedDeliveriesPerSecond: Number((receivedDeliveries / elapsedSeconds).toFixed(2)),
      latencyMs: {
        p50: percentile(latenciesMs, 0.5),
        p95: percentile(latenciesMs, 0.95),
        max: latenciesMs.length ? Math.max(...latenciesMs) : null,
      },
      publishStatuses: targetUrl ? null : publishCounts,
      rssBeforeMiB: Number((rssBefore / 1024 / 1024).toFixed(2)),
      rssAfterMiB: Number((rssAfter / 1024 / 1024).toFixed(2)),
      rssDeltaMiB: Number(((rssAfter - rssBefore) / 1024 / 1024).toFixed(2)),
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (deliveryResult !== "complete" || receivedDeliveries !== expectedDeliveries) {
    process.exitCode = 1;
  }
} finally {
  for (const socket of sockets) socket.close();
  await server?.stop(true);
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error("Timed out opening benchmark socket")), 5_000);
    socket.addEventListener("open", () => {
      clearTimeout(timeoutId);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeoutId);
      reject(new Error("Benchmark WebSocket handshake failed"));
    }, { once: true });
  });
}
