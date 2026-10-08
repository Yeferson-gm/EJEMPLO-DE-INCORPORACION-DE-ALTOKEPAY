import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { env } from '#config/env';

import { exampleRepository } from '#data/exampleRepository';
import { products } from '#domain/catalog';
import type { DemoPayer } from '#domain/payer';
import type { CheckoutMethod } from '#domain/types';
import {
  cancelCheckout,
  createCheckout,
  findCheckoutByExternalId,
  findCheckoutById,
  findCheckoutStatusById,
  retryCheckout,
} from '#services/checkoutService';
import {
  cancelCheckoutOrder,
  findAuthorizedOrder,
  listCheckoutMethods,
  processCheckoutWebhook,
  refreshAuthorizedCheckoutOrder,
  retryCheckoutOrder,
  startCheckoutOrder,
} from '#services/orderService';
import { configureTestEnvironment } from './testConfig';

type CapturedRequest = { readonly url: string; readonly init: RequestInit };
const originalFetch = globalThis.fetch;
const walletId = '11111111-1111-4111-8111-111111111111';
const payer: DemoPayer = {
  id: '11111111-1111-4111-8111-111111111112',
  dni: '45382026',
  createdAt: '2026-10-08T12:00:00.000Z',
};
const method: CheckoutMethod = {
  providerCode: 'yape',
  displayName: 'Yape',
  currencies: ['PEN'],
  iconUrl: 'https://assets.altokepay.test/yape.png',
  acceptedWallets: [{ id: walletId, code: 'lemon', name: 'Lemon', iconUrl: 'https://assets.altokepay.test/lemon.png' }],
};
let requests: CapturedRequest[] = [];
let responder: (request: CapturedRequest) => Response;
const success = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify({ success: true, data }), { status, headers: { 'Content-Type': 'application/json' } });
const bodyOf = (request: CapturedRequest): Record<string, unknown> =>
  JSON.parse(String(request.init.body)) as Record<string, unknown>;
const buildCheckout = (body: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  externalId: String(body.externalId ?? 'external-id'),
  providerCode: String(body.providerCode ?? 'yape'),
  acceptedWalletId: String(body.acceptedWalletId ?? walletId),
  acceptedWallet: method.acceptedWallets[0],
  paymentExpectation: { message: 'Yape está esperando un pago desde Lemon' },
  matchingMode: 'expected_sender',
  amount: 19.9,
  currency: 'PEN',
  status: 'awaiting_payment',
  expiresAt: '2026-12-01T12:15:00.000Z',
  checkoutAsset: { secureUrl: 'https://assets.altokepay.test/qr.png' },
});

beforeEach(async () => {
  configureTestEnvironment();
  requests = [];
  await exampleRepository.mutateOrders(() => [[], undefined] as const);
  await exampleRepository.mutateWebhookReceipts(() => [[], undefined] as const);
  await exampleRepository.writeTokens({
    accessToken: 'access-token',
    accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
  });
  globalThis.fetch = ((input, init = {}) => {
    const request = { url: String(input), init };
    requests.push(request);
    return Promise.resolve(responder(request));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Checkout Client API coverage', () => {
  test('implements exactly the six point Checkout operations', async () => {
    responder = request => {
      const pathname = new URL(request.url).pathname;
      const checkout = {
        ...buildCheckout(request.init.body ? bodyOf(request) : { externalId: 'external-id' }),
        id: 'checkout-1',
      };
      if (pathname.endsWith('/cancel')) return success({ changed: true, checkout });
      if (pathname.endsWith('/retry')) return success({ checkout });
      return success(checkout);
    };
    await createCheckout({ externalId: crypto.randomUUID() });
    await findCheckoutByExternalId('external-id');
    await findCheckoutById('checkout-1');
    await findCheckoutStatusById('checkout-1');
    await cancelCheckout('checkout-1');
    await retryCheckout('checkout-1', { externalId: crypto.randomUUID() });
    expect(requests.map(request => `${request.init.method ?? 'GET'} ${new URL(request.url).pathname}`)).toEqual([
      'POST /api/v1/client/checkouts',
      'GET /api/v1/client/checkouts/external/external-id',
      'GET /api/v1/client/checkouts/checkout-1',
      'GET /api/v1/client/checkouts/checkout-1/status',
      'POST /api/v1/client/checkouts/checkout-1/cancel',
      'POST /api/v1/client/checkouts/checkout-1/retry',
    ]);
  });

  test('rejects malformed Checkout DTOs for create, reads, cancel, retry, and payment methods', async () => {
    responder = () => success({ id: 'checkout-1' });

    await expect(createCheckout({ externalId: crypto.randomUUID() })).rejects.toMatchObject({
      code: 'ALTOKEPAY_CHECKOUT_MISMATCH',
    });
    await expect(findCheckoutByExternalId('external-id')).rejects.toMatchObject({
      code: 'ALTOKEPAY_CHECKOUT_MISMATCH',
    });
    await expect(findCheckoutById('checkout-1')).rejects.toMatchObject({ code: 'ALTOKEPAY_CHECKOUT_MISMATCH' });
    await expect(findCheckoutStatusById('checkout-1')).rejects.toMatchObject({
      code: 'ALTOKEPAY_CHECKOUT_MISMATCH',
    });
    await expect(cancelCheckout('checkout-1')).rejects.toMatchObject({ code: 'ALTOKEPAY_CHECKOUT_MISMATCH' });
    await expect(retryCheckout('checkout-1', { externalId: crypto.randomUUID() })).rejects.toMatchObject({
      code: 'ALTOKEPAY_CHECKOUT_MISMATCH',
    });
    await expect(listCheckoutMethods('PEN')).rejects.toMatchObject({ code: 'ALTOKEPAY_PAYMENT_METHOD_MISMATCH' });
  });

  test('creates a UUID order with a hashed browser capability and direct absolute icon URLs', async () => {
    const product = products[0];
    if (!product) throw new Error('Missing test product');
    responder = request => {
      if (request.url.endsWith('/payment-methods/checkout')) return success([method]);
      return success(buildCheckout(bodyOf(request)), 201);
    };
    const result = await startCheckoutOrder(
      {
        productId: product.id,
        providerCode: 'yape',
        acceptedWalletId: walletId,
      },
      payer,
    );
    expect(result.status).toBe(201);
    expect(result.body.order?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(result.body.orderToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.body.order).not.toHaveProperty('orderTokenHash');
    expect('availableMethods' in result.body ? result.body.availableMethods[0]?.iconUrl : undefined).toBe(
      method.iconUrl,
    );
    const stored = (await exampleRepository.readOrders())[0];
    expect(stored?.orderTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.orderTokenHash).not.toBe(result.body.orderToken);
    expect(bodyOf(requests[1] ?? { url: '', init: {} })).toMatchObject({
      payerDni: payer.dni,
      amount: product.amount,
      currency: product.currency,
    });
    expect(bodyOf(requests[1] ?? { url: '', init: {} })).not.toHaveProperty('payerName');
    expect(findAuthorizedOrder(stored?.id ?? '', 'wrong-token')).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });

  test('refreshes an authorized order through all three Checkout read operations', async () => {
    const product = products[0];
    if (!product) throw new Error('Missing test product');
    responder = request => {
      if (request.url.endsWith('/payment-methods/checkout')) return success([method]);
      return success({ ...buildCheckout(bodyOf(request)), id: 'checkout-1' }, 201);
    };
    const started = await startCheckoutOrder(
      {
        productId: product.id,
        providerCode: 'yape',
        acceptedWalletId: walletId,
      },
      payer,
    );
    const orderId = started.body.order?.id;
    const orderToken = 'orderToken' in started.body ? started.body.orderToken : undefined;
    if (!orderId || !orderToken) throw new Error('Missing order authorization');

    requests = [];
    const checkout = {
      ...buildCheckout({ externalId: orderId, providerCode: 'yape', acceptedWalletId: walletId }),
      id: 'checkout-1',
    };
    responder = () => success(checkout);

    const refreshed = await refreshAuthorizedCheckoutOrder(orderId, orderToken);

    expect(refreshed.checkoutId).toBe('checkout-1');
    expect(requests.map(request => new URL(request.url).pathname).sort()).toEqual(
      [
        `/api/v1/client/checkouts/external/${orderId}`,
        '/api/v1/client/checkouts/checkout-1',
        '/api/v1/client/checkouts/checkout-1/status',
      ].sort(),
    );

    responder = request =>
      new URL(request.url).pathname.endsWith('/status')
        ? success({ ...checkout, status: 'expired' })
        : success(checkout);
    const expired = await refreshAuthorizedCheckoutOrder(orderId, orderToken);
    expect(expired.paymentStatus).toBe('expired');
  });

  test('authorizes cancel and retry with the local capability and rotates it for the new order', async () => {
    const product = products[0];
    if (!product) throw new Error('Missing test product');
    let originalExternalId = '';
    responder = request => {
      if (request.url.endsWith('/payment-methods/checkout')) return success([method]);
      if (request.url.endsWith('/retry')) {
        const body = bodyOf(request);
        return success(
          {
            checkout: {
              ...buildCheckout({ ...body, providerCode: 'yape', acceptedWalletId: walletId }),
              id: 'checkout-2',
            },
          },
          201,
        );
      }
      if (request.url.endsWith('/cancel')) {
        return success({
          changed: true,
          checkout: { ...buildCheckout({ externalId: originalExternalId }), id: 'checkout-1', status: 'canceled' },
        });
      }
      const body = bodyOf(request);
      originalExternalId = String(body.externalId);
      return success({ ...buildCheckout(body), id: 'checkout-1' }, 201);
    };
    const started = await startCheckoutOrder(
      {
        productId: product.id,
        providerCode: 'yape',
        acceptedWalletId: walletId,
      },
      payer,
    );
    const orderId = started.body.order?.id;
    const orderToken = 'orderToken' in started.body ? started.body.orderToken : undefined;
    if (!orderId || !orderToken) throw new Error('Missing order authorization');
    const canceled = await cancelCheckoutOrder(orderId, orderToken);
    expect(canceled.body.order?.paymentStatus).toBe('canceled');
    const retried = await retryCheckoutOrder(orderId, orderToken);
    expect(retried.body.order?.id).not.toBe(orderId);
    expect(retried.body.orderToken).not.toBe(started.body.orderToken);
  });

  test('contains no icon or generic Client API proxies', async () => {
    const routeSource = await readFile(new URL('../src/routes/checkoutRoutes.ts', import.meta.url), 'utf8');
    expect(routeSource).not.toContain('payment-method-icons');
    expect(routeSource).not.toContain('/api/v1/client/');
    expect(routeSource).not.toContain('/api/payment-links');
  });
});

describe('Checkout webhook processing', () => {
  test('uses the signed snapshot only and terminally deduplicates processed events', async () => {
    const product = products[0];
    if (!product) throw new Error('Missing test product');
    responder = request => {
      if (request.url.endsWith('/payment-methods/checkout')) return success([method]);
      return success({ ...buildCheckout(bodyOf(request)), id: 'checkout-1' }, 201);
    };
    const started = await startCheckoutOrder(
      {
        productId: product.id,
        providerCode: 'yape',
        acceptedWalletId: walletId,
      },
      payer,
    );
    requests = [];
    const order = (await exampleRepository.readOrders())[0];
    if (!order?.checkoutId) throw new Error('Missing checkout');
    const payload = {
      id: 'event-1',
      type: 'checkout.paid',
      environment: env.ALTOKEPAY_ENVIRONMENT ?? 'sandbox',
      livemode: env.ALTOKEPAY_ENVIRONMENT === 'production',
      createdAt: new Date().toISOString(),
      data: {
        checkout: {
          id: order.checkoutId,
          externalId: order.externalId,
          providerCode: 'yape',
          amount: product.amount,
          currency: product.currency,
          status: 'paid',
        },
        payment: {
          id: 'payment-1',
          providerCode: 'yape',
          amount: product.amount,
          currency: product.currency,
          status: 'processed',
        },
      },
    };
    const first = await processCheckoutWebhook('event-1', 'delivery-1', payload);
    const duplicate = await processCheckoutWebhook('event-1', 'delivery-2', payload);
    expect(first.updated).toBe(true);
    expect(duplicate.duplicate).toBe(true);
    expect(requests).toHaveLength(0);
    expect((await exampleRepository.readOrders())[0]?.paymentStatus).toBe('paid');
    expect((await exampleRepository.readWebhookReceipts())[0]).toMatchObject({
      status: 'processed',
      deliveryIds: ['delivery-1', 'delivery-2'],
    });
    expect(started.body.orderToken).toBeString();
  });

  test('processes every state-only Checkout webhook type', async () => {
    const product = products[0];
    if (!product) throw new Error('Missing test product');
    responder = request => {
      if (request.url.endsWith('/payment-methods/checkout')) return success([method]);
      return success({ ...buildCheckout(bodyOf(request)), id: 'checkout-state' }, 201);
    };
    await startCheckoutOrder({ productId: product.id, providerCode: 'yape', acceptedWalletId: walletId }, payer);
    const order = (await exampleRepository.readOrders())[0];
    if (!order?.checkoutId) throw new Error('Missing checkout');

    for (const [index, type, status] of [
      [1, 'checkout.created', 'awaiting_payment'],
      [2, 'checkout.expired', 'expired'],
      [3, 'checkout.canceled', 'canceled'],
    ] as const) {
      const result = await processCheckoutWebhook(`event-state-${index}`, `delivery-state-${index}`, {
        id: `event-state-${index}`,
        type,
        environment: env.ALTOKEPAY_ENVIRONMENT ?? 'sandbox',
        livemode: env.ALTOKEPAY_ENVIRONMENT === 'production',
        createdAt: new Date().toISOString(),
        data: {
          checkout: {
            id: order.checkoutId,
            externalId: order.externalId,
            providerCode: 'yape',
            amount: product.amount,
            currency: product.currency,
            status,
          },
        },
      });
      expect(result).toMatchObject({ updated: true, retryable: false });
      expect(
        (await exampleRepository.readWebhookReceipts()).find(receipt => receipt.eventId === `event-state-${index}`),
      ).toMatchObject({ status: 'processed' });
    }
  });

  test('validates retry lineage against both the retry order and its previous order', async () => {
    const product = products[0];
    if (!product) throw new Error('Missing test product');
    responder = request => {
      if (request.url.endsWith('/payment-methods/checkout')) return success([method]);
      if (request.url.endsWith('/retry')) {
        const body = bodyOf(request);
        return success({ checkout: { ...buildCheckout(body), id: 'checkout-retry' } }, 201);
      }
      return success({ ...buildCheckout(bodyOf(request)), id: 'checkout-original' }, 201);
    };
    const started = await startCheckoutOrder(
      { productId: product.id, providerCode: 'yape', acceptedWalletId: walletId },
      payer,
    );
    const originalId = started.body.order?.id;
    const token = 'orderToken' in started.body ? started.body.orderToken : undefined;
    if (!originalId || !token) throw new Error('Missing original order');
    const retried = await retryCheckoutOrder(originalId, token);
    const retryOrder = retried.body.order;
    if (!retryOrder?.checkoutId) throw new Error('Missing retry order');

    const payload = {
      id: 'event-retry',
      type: 'checkout.retry_created' as const,
      environment: env.ALTOKEPAY_ENVIRONMENT ?? 'sandbox',
      livemode: env.ALTOKEPAY_ENVIRONMENT === 'production',
      createdAt: new Date().toISOString(),
      data: {
        checkout: {
          id: retryOrder.checkoutId,
          externalId: retryOrder.externalId,
          providerCode: 'yape',
          amount: product.amount,
          currency: product.currency,
          status: 'awaiting_payment',
        },
        retry: {
          retryOfCheckoutId: 'checkout-original',
          retryOfExternalId: originalId,
        },
      },
    };
    await expect(
      processCheckoutWebhook('event-retry-malformed', 'delivery-retry-malformed', {
        ...payload,
        id: 'event-retry-malformed',
        data: { checkout: payload.data.checkout },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_WEBHOOK_PAYLOAD' });
    await expect(
      processCheckoutWebhook('event-retry-lineage', 'delivery-retry-lineage', {
        ...payload,
        id: 'event-retry-lineage',
        data: { ...payload.data, retry: { ...payload.data.retry, retryOfExternalId: 'wrong-order' } },
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_ORDER_MISMATCH' });
    expect(await processCheckoutWebhook('event-retry', 'delivery-retry', payload)).toMatchObject({
      updated: true,
      retryable: false,
    });

    await exampleRepository.mutateOrders(
      orders => [orders.filter(order => order.id !== originalId), undefined] as const,
    );
    const missingPrevious = await processCheckoutWebhook('event-retry-missing-order', 'delivery-retry-missing-order', {
      ...payload,
      id: 'event-retry-missing-order',
    });
    expect(missingPrevious).toMatchObject({ updated: false, retryable: true });
    expect(
      (await exampleRepository.readWebhookReceipts()).find(receipt => receipt.eventId === 'event-retry-missing-order'),
    ).toMatchObject({ status: 'retryable_missing_order' });
  });

  test('terminally processes webhook.ping and payment.received as validated no-ops', async () => {
    const noOps = [
      {
        id: 'event-ping',
        type: 'webhook.ping' as const,
        environment: 'sandbox' as const,
        livemode: false,
        createdAt: new Date().toISOString(),
        data: {
          message: 'AltokePay webhook test delivery',
          endpoint: { id: 'endpoint-1', name: 'Demo', url: 'https://example.test/webhooks' },
          organizationId: 'organization-1',
        },
      },
      {
        id: 'event-payment',
        type: 'payment.received' as const,
        environment: 'sandbox' as const,
        livemode: false,
        createdAt: new Date().toISOString(),
        data: {
          payment: {
            id: 'payment-1',
            providerCode: 'yape',
            amount: 10,
            currency: 'PEN',
            occurredAt: new Date().toISOString(),
            status: 'processed',
            createdAt: new Date().toISOString(),
          },
        },
      },
    ];

    for (const payload of noOps) {
      const result = await processCheckoutWebhook(payload.id, `delivery-${payload.id}`, payload);
      expect(result).toEqual({ duplicate: false, updated: false, retryable: false, order: null });
      expect(
        (await exampleRepository.readWebhookReceipts()).find(receipt => receipt.eventId === payload.id),
      ).toMatchObject({
        status: 'processed',
        updated: false,
      });
    }
  });

  test('rejects malformed no-op webhook payloads instead of ignoring them as unsupported', async () => {
    await expect(
      processCheckoutWebhook('event-bad-ping', 'delivery-bad-ping', {
        id: 'event-bad-ping',
        type: 'webhook.ping',
        environment: 'sandbox',
        livemode: false,
        createdAt: new Date().toISOString(),
        data: { message: 'missing endpoint and organization' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_WEBHOOK_PAYLOAD' });
  });

  test('keeps missing-order receipts retryable', async () => {
    const payload = {
      id: 'event-missing',
      type: 'checkout.paid',
      environment: 'sandbox' as const,
      livemode: false,
      createdAt: new Date().toISOString(),
      data: {
        checkout: {
          id: 'checkout-missing',
          externalId: crypto.randomUUID(),
          providerCode: 'yape',
          amount: 1,
          currency: 'PEN',
          status: 'paid',
        },
        payment: { id: 'payment-1', providerCode: 'yape', amount: 1, currency: 'PEN', status: 'processed' },
      },
    };
    const result = await processCheckoutWebhook('event-missing', 'delivery-1', payload);
    expect(result.retryable).toBe(true);
    expect((await exampleRepository.readWebhookReceipts())[0]?.status).toBe('retryable_missing_order');
  });
});
