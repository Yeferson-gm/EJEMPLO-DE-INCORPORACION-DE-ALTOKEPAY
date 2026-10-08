import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import * as v from 'valibot';
import { env } from '#config/env';
import { products, startCheckoutSchema } from '#domain/catalog';
import { payerInputSchema, payerProjection } from '#domain/payer';
import { HttpError } from '#lib/httpError';
import { parseRequest, readJson } from '#routes/request';
import {
  cancelCheckoutOrder,
  listCheckoutMethods,
  refreshAuthorizedCheckoutOrder,
  retryCheckoutOrder,
  startCheckoutOrder,
} from '#services/orderService';
import {
  createPayerSession,
  findPayerBySessionToken,
  payerSessionCookieName,
  payerSessionMaxAgeSeconds,
  requirePayerBySessionToken,
} from '#services/payerSessionService';

const orderIdSchema = v.pipe(v.string(), v.uuid());
const currencySchema = v.pipe(v.string(), v.toUpperCase(), v.regex(/^[A-Z]{3}$/));

const readOrderToken = (request: Request): string => {
  const token = request.headers.get('x-order-token')?.trim();
  if (!token) throw new HttpError(404, 'ORDER_NOT_FOUND', 'No encontramos la orden solicitada.');
  return token;
};

export const checkoutRoutes = new Hono()
  .get('/api/session/payer', async context => {
    const payer = await findPayerBySessionToken(getCookie(context, payerSessionCookieName));
    return context.json({ payer: payer ? payerProjection : null });
  })
  .post('/api/session/payer', async context => {
    const input = parseRequest(payerInputSchema, await readJson(context.req.raw));
    const session = await createPayerSession(input, getCookie(context, payerSessionCookieName));
    setCookie(context, payerSessionCookieName, session.token, {
      httpOnly: true,
      maxAge: payerSessionMaxAgeSeconds,
      path: '/',
      sameSite: 'Strict',
      secure: env.EXAMPLE_PUBLIC_URL?.startsWith('https://') === true,
    });
    return context.json({ payer: payerProjection }, 201);
  })
  .get('/api/products', context => context.json({ products }))
  .get('/api/payment-methods', async context => {
    const currency = parseRequest(currencySchema, context.req.query('currency') ?? '');
    return context.json({ methods: await listCheckoutMethods(currency) });
  })
  .get('/api/orders/:orderId', async context => {
    const orderId = parseRequest(orderIdSchema, context.req.param('orderId'));
    const order = await refreshAuthorizedCheckoutOrder(orderId, readOrderToken(context.req.raw));
    return context.json({ order });
  })
  .post('/api/orders/start-checkout', async context => {
    const payer = await requirePayerBySessionToken(getCookie(context, payerSessionCookieName));
    const result = await startCheckoutOrder(parseRequest(startCheckoutSchema, await readJson(context.req.raw)), payer);
    return context.json(result.body, result.status);
  })
  .post('/api/orders/:orderId/retry-checkout', async context => {
    const orderId = parseRequest(orderIdSchema, context.req.param('orderId'));
    const result = await retryCheckoutOrder(orderId, readOrderToken(context.req.raw));
    return context.json(result.body, result.status);
  })
  .post('/api/orders/:orderId/cancel-checkout', async context => {
    const orderId = parseRequest(orderIdSchema, context.req.param('orderId'));
    const result = await cancelCheckoutOrder(orderId, readOrderToken(context.req.raw));
    return context.json(result.body, result.status);
  });
