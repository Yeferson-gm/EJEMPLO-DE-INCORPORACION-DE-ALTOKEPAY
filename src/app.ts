import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { maximumJsonBodyBytes } from '#config/constants';
import { paths } from '#config/paths';
import { HttpError, toSafeHttpError } from '#lib/httpError';
import { checkoutRoutes } from '#routes/checkoutRoutes';
import { paymentLinkRoutes } from '#routes/paymentLinkRoutes';
import { webhookRoutes } from '#routes/webhookRoutes';
import { merchantBasicAuth } from '#services/merchantBasicAuth';

export const createApp = () => {
  const app = new Hono();
  app.use('*', async (context, next) => {
    const contentLength = Number(context.req.header('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > maximumJsonBodyBytes) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    await next();
    context.header('X-Content-Type-Options', 'nosniff');
    context.header('X-Frame-Options', 'DENY');
    context.header('Referrer-Policy', 'no-referrer');
    context.header('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
    context.header('Cross-Origin-Opener-Policy', 'same-origin');
    context.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' https: data:; connect-src 'self' ws: wss:; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (context.req.path.startsWith('/api/') || context.req.method !== 'GET') {
      context.header('Cache-Control', 'no-store');
      context.header('Pragma', 'no-cache');
    }
  });
  app.use('*', merchantBasicAuth);
  app.route('/', checkoutRoutes);
  app.route('/', paymentLinkRoutes);
  app.route('/', webhookRoutes);
  app.use('*', serveStatic({ root: paths.publicDir }));
  app.notFound(context => context.json({ error: 'Route not found', code: 'ROUTE_NOT_FOUND' }, 404));
  app.onError((error, context) => {
    const safe = toSafeHttpError(error);
    return context.json(
      { error: safe.message, code: safe.code },
      safe.status as 400 | 401 | 404 | 409 | 413 | 422 | 500 | 502 | 503,
    );
  });
  return app;
};

export type AppType = ReturnType<typeof createApp>;
