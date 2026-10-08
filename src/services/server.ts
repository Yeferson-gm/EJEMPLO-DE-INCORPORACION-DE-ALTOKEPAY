import { createApp } from '#app';
import { assertExampleRuntimeConfig, env } from '#config/env';
import { orderRealtime } from '#realtime/orderRealtime';
import { validateAltokePayClient } from '#services/altokePayClient';
import { createGracefulShutdown } from '#services/gracefulShutdown';

assertExampleRuntimeConfig(env);
await validateAltokePayClient();

const app = createApp();
const realtimeHandler = orderRealtime.handler();
const server = Bun.serve({
  port: Number(env.EXAMPLE_PORT),
  maxRequestBodySize: 1024 * 1024,
  idleTimeout: 30,
  websocket: realtimeHandler.websocket,
  fetch: (request, bunServer) =>
    orderRealtime.handles(request) ? realtimeHandler.fetch(request, bunServer) : app.fetch(request, bunServer),
  error: () => new Response('Internal server error', { status: 500 }),
});

console.log(`Example ecommerce running on ${env.EXAMPLE_PUBLIC_URL?.replace(/\/$/, '')} (local port ${server.port})`);

const shutdown = createGracefulShutdown([() => orderRealtime.close(), () => server.stop(true)], {
  timeoutMs: 5_000,
  repeatedSignalGraceMs: 500,
  now: Date.now,
  exit: code => process.exit(code),
  log: message => console.log(message),
  logError: (message, error) => console.error(message, error),
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const) {
  process.on(signal, () => void shutdown(signal));
}
