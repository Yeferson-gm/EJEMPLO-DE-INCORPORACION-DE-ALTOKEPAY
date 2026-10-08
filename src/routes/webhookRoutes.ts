import { Hono } from 'hono';
import * as v from 'valibot';
import { maximumJsonBodyBytes } from '#config/constants';
import { HttpError } from '#lib/httpError';
import { orderRealtime } from '#realtime/orderRealtime';
import { processCheckoutWebhook, webhookEnvelopeSchema } from '#services/orderService';
import { isAltokePayWebhookConfigured, verifyAltokePayWebhookRequest } from '#services/webhookSignatureService';

export const webhookRoutes = new Hono().post('/webhooks/altokepay', async context => {
  if (!isAltokePayWebhookConfigured()) {
    throw new HttpError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook receiver is not configured');
  }
  const rawBody = new Uint8Array(await context.req.arrayBuffer());
  if (rawBody.byteLength === 0 || rawBody.byteLength > maximumJsonBodyBytes) {
    throw new HttpError(413, 'INVALID_WEBHOOK_SIZE', 'Invalid webhook body size');
  }
  const verified = verifyAltokePayWebhookRequest(context.req.raw, rawBody);
  if (!verified) throw new HttpError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Unauthorized');
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    throw new HttpError(400, 'INVALID_WEBHOOK_JSON', 'Invalid webhook payload');
  }
  const parsed = v.safeParse(webhookEnvelopeSchema, input);
  if (!parsed.success || parsed.output.id !== verified.eventId || parsed.output.environment !== verified.environment) {
    throw new HttpError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Invalid webhook payload');
  }
  const result = await processCheckoutWebhook(verified.eventId, verified.deliveryId, parsed.output);
  if (result.retryable) {
    return context.json({ received: false, retryable: true }, 503);
  }
  if (result.order) orderRealtime.publishOrderUpdated(result.order);
  return context.json({ received: true, duplicate: result.duplicate, orderUpdated: result.updated });
});
