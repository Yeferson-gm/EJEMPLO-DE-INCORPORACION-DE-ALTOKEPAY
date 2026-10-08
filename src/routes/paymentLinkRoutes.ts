import { Hono } from 'hono';
import * as v from 'valibot';
import { createLocalPaymentLinkSchema } from '#domain/paymentLink';
import { parseRequest, readJson } from '#routes/request';
import {
  cancelLocalPaymentLink,
  createLocalPaymentLink,
  listLocalPaymentLinks,
  recoverLocalPaymentLinkPublicUrl,
  refreshLocalPaymentLink,
} from '#services/merchantPaymentLinkService';

const paymentLinkIdSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200));

export const paymentLinkRoutes = new Hono()
  .get('/api/payment-links', async context => context.json({ paymentLinks: await listLocalPaymentLinks() }))
  .post('/api/payment-links', async context => {
    const result = await createLocalPaymentLink(
      parseRequest(createLocalPaymentLinkSchema, await readJson(context.req.raw)),
    );
    return context.json(result, 201);
  })
  .post('/api/payment-links/:paymentLinkId/refresh', async context => {
    const paymentLinkId = parseRequest(paymentLinkIdSchema, context.req.param('paymentLinkId'));
    return context.json({ paymentLink: await refreshLocalPaymentLink(paymentLinkId) });
  })
  .post('/api/payment-links/:paymentLinkId/cancel', async context => {
    const paymentLinkId = parseRequest(paymentLinkIdSchema, context.req.param('paymentLinkId'));
    return context.json({ paymentLink: await cancelLocalPaymentLink(paymentLinkId) });
  })
  .post('/api/payment-links/:paymentLinkId/recover-public-url', async context => {
    const paymentLinkId = parseRequest(paymentLinkIdSchema, context.req.param('paymentLinkId'));
    return context.json(await recoverLocalPaymentLinkPublicUrl(paymentLinkId));
  });
