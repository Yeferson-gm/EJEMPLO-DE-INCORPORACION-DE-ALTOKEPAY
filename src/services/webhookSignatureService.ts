import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '#config/env';
import type { Environment } from '#domain/types';

const maximumTimestampAgeSeconds = 5 * 60;
const headerNames = {
  webhookId: 'x-altokepay-webhook-id',
  deliveryId: 'x-altokepay-delivery-id',
  eventId: 'x-altokepay-event-id',
  environment: 'x-altokepay-environment',
  timestamp: 'x-altokepay-timestamp',
  signature: 'x-altokepay-signature',
  attempt: 'x-altokepay-attempt',
} as const;

export type VerifiedWebhookRequest = {
  readonly webhookId: string;
  readonly deliveryId: string;
  readonly eventId: string;
  readonly environment: Environment;
  readonly attempt: number;
};

const readSingleHeader = (headers: Headers, name: string, pattern: RegExp): string | null => {
  const value = headers.get(name)?.trim() ?? '';
  return value && !value.includes(',') && pattern.test(value) ? value : null;
};

export const isAltokePayWebhookConfigured = (): boolean => env.ALTOKEPAY_WEBHOOK_SECRET.length > 0;

export const verifyAltokePayWebhookRequest = (
  request: Request,
  rawBody: Uint8Array,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifiedWebhookRequest | null => {
  if (!isAltokePayWebhookConfigured()) return null;
  const webhookId = readSingleHeader(request.headers, headerNames.webhookId, /^[A-Za-z0-9_-]{1,160}$/);
  const deliveryId = readSingleHeader(request.headers, headerNames.deliveryId, /^[A-Za-z0-9_-]{1,160}$/);
  const eventId = readSingleHeader(request.headers, headerNames.eventId, /^[A-Za-z0-9_-]{1,160}$/);
  const environment = readSingleHeader(
    request.headers,
    headerNames.environment,
    /^(production|sandbox)$/,
  ) as Environment | null;
  const timestamp = readSingleHeader(request.headers, headerNames.timestamp, /^\d{10}$/);
  const signature = readSingleHeader(request.headers, headerNames.signature, /^[a-fA-F0-9]{64}$/);
  const attemptValue = readSingleHeader(request.headers, headerNames.attempt, /^[1-9]\d{0,8}$/);
  if (!webhookId || !deliveryId || !eventId || !environment || !timestamp || !signature || !attemptValue) return null;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > maximumTimestampAgeSeconds)
    return null;
  const expected = createHmac('sha256', env.ALTOKEPAY_WEBHOOK_SECRET)
    .update(`${timestamp}.`, 'utf8')
    .update(rawBody)
    .digest();
  const received = Buffer.from(signature, 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  return { webhookId, deliveryId, eventId, environment, attempt: Number(attemptValue) };
};
