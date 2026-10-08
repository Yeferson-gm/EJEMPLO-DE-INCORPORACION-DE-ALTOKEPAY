import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createApp } from '#app';

import { exampleRepository } from '#data/exampleRepository';
import {
  cancelLocalPaymentLink,
  createLocalPaymentLink,
  listLocalPaymentLinks,
  recoverLocalPaymentLinkPublicUrl,
  refreshLocalPaymentLink,
} from '#services/merchantPaymentLinkService';
import {
  cancelPaymentLink,
  createPaymentLink,
  findPaymentLinkByExternalId,
  findPaymentLinkById,
  findPaymentLinkStatusById,
} from '#services/paymentLinkService';
import { configureTestEnvironment } from './testConfig';

type CapturedRequest = { readonly url: string; readonly init: RequestInit };
const originalFetch = globalThis.fetch;
const merchantUsername = 'merchant-demo';
const merchantPassword = 'correct-horse-battery-staple';
const merchantAuthorization = `Basic ${Buffer.from(`${merchantUsername}:${merchantPassword}`, 'utf8').toString('base64')}`;
const createdAt = '2026-09-09T12:00:00.000Z';
const expiresAt = '2026-09-09T12:15:00.000Z';
const publicUrl = 'https://pay.altokepay.test/pay/opaque-capability';

let requests: CapturedRequest[] = [];
let responder: (request: CapturedRequest) => Response;
const success = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify({ success: true, data }), { status, headers: { 'Content-Type': 'application/json' } });
const bodyOf = (request: CapturedRequest): Record<string, unknown> =>
  JSON.parse(String(request.init.body)) as Record<string, unknown>;
const paymentLinkView = (overrides: Record<string, unknown> = {}) => ({
  id: 'link-1',
  amount: 24.9,
  currency: 'PEN',
  message: 'Pedido 1048',
  merchantDisplayName: 'AltokePay Store',
  publicUrl,
  status: 'awaiting_payment',
  expiresAt,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

beforeEach(async () => {
  configureTestEnvironment();
  requests = [];
  await exampleRepository.mutatePaymentLinks(() => [[], undefined] as const);
  await exampleRepository.mutatePaymentLinkIntents(() => [[], undefined] as const);
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

describe('Payment Link Client API coverage', () => {
  test('implements exactly the five current point operations', async () => {
    responder = request =>
      success(paymentLinkView({ externalId: request.init.body ? bodyOf(request).externalId : undefined }));
    await createPaymentLink({ externalId: 'link-order', amount: 2 });
    await findPaymentLinkByExternalId('link-order');
    await findPaymentLinkById('link-1');
    await findPaymentLinkStatusById('link-1');
    await cancelPaymentLink('link-1');
    expect(requests.map(request => `${request.init.method ?? 'GET'} ${new URL(request.url).pathname}`)).toEqual([
      'POST /api/v1/client/payment-links',
      'GET /api/v1/client/payment-links/external/link-order',
      'GET /api/v1/client/payment-links/link-1',
      'GET /api/v1/client/payment-links/link-1/status',
      'POST /api/v1/client/payment-links/link-1/cancel',
    ]);
    expect(new Headers(requests[0]?.init.headers).get('idempotency-key')).toBe('link-order');
  });

  test('creates links with either identity mode without requiring a product or payer session', async () => {
    responder = request => {
      const body = bodyOf(request);
      return success(
        paymentLinkView({ ...body, id: body.payerIdentityType === 'dni' ? 'link-dni' : 'link-name' }),
        201,
      );
    };
    const withDni = await createLocalPaymentLink({
      intentId: '11111111-1111-4111-8111-111111111121',
      amount: 24.9,
      message: 'Pedido 1048',
      expirationMinutes: 15,
      payerIdentityType: 'dni',
      payerDni: '45382026',
    });
    const withName = await createLocalPaymentLink({
      intentId: '11111111-1111-4111-8111-111111111122',
      amount: 49.5,
      message: 'Reserva',
      expirationMinutes: 60,
      payerIdentityType: 'name',
      payerName: 'Cliente de Prueba',
    });

    expect(withDni.publicUrl).toBe(publicUrl);
    expect(withName.publicUrl).toBe(publicUrl);
    expect(bodyOf(requests[0] ?? { url: '', init: {} })).toMatchObject({
      amount: 24.9,
      payerIdentityType: 'dni',
      payerDni: '45382026',
    });
    expect(bodyOf(requests[1] ?? { url: '', init: {} })).toMatchObject({
      amount: 49.5,
      payerIdentityType: 'name',
      payerName: 'Cliente de Prueba',
    });
    expect(bodyOf(requests[0] ?? { url: '', init: {} })).not.toHaveProperty('productId');
    expect(await exampleRepository.readPaymentLinks()).toHaveLength(2);
    expect(await exampleRepository.readPaymentLinks()).toContainEqual(expect.objectContaining({ publicUrl }));
    expect(await listLocalPaymentLinks()).not.toContainEqual(expect.objectContaining({ publicUrl }));
  });

  test('refreshes a local record with the three point reads and validates returned identity', async () => {
    responder = () => success(paymentLinkView(), 201);
    const created = await createLocalPaymentLink({
      intentId: '11111111-1111-4111-8111-111111111123',
      amount: 24.9,
      message: 'Pedido 1048',
      expirationMinutes: 15,
      payerIdentityType: 'name',
      payerName: 'Cliente de Prueba',
    });
    requests = [];
    responder = request =>
      new URL(request.url).pathname.endsWith('/status')
        ? success({ id: 'link-1', status: 'paid', expiresAt, updatedAt: '2026-09-09T12:05:00.000Z' })
        : success(paymentLinkView({ status: 'paid', updatedAt: '2026-09-09T12:05:00.000Z' }));

    const refreshed = await refreshLocalPaymentLink(created.paymentLink.id);
    expect(refreshed.status).toBe('paid');
    expect(requests.map(request => new URL(request.url).pathname).sort()).toEqual(
      [
        `/api/v1/client/payment-links/external/${created.paymentLink.externalId}`,
        '/api/v1/client/payment-links/link-1',
        '/api/v1/client/payment-links/link-1/status',
      ].sort(),
    );

    responder = request =>
      new URL(request.url).pathname.includes('/external/')
        ? success(paymentLinkView({ id: 'different-link' }))
        : success(
            new URL(request.url).pathname.endsWith('/status')
              ? { id: 'link-1', status: 'paid', expiresAt, updatedAt: createdAt }
              : paymentLinkView(),
          );
    expect(refreshLocalPaymentLink(created.paymentLink.id)).rejects.toMatchObject({
      code: 'ALTOKEPAY_PAYMENT_LINK_MISMATCH',
    });
  });

  test('cancels an awaiting local record and stores the authoritative response', async () => {
    responder = () => success(paymentLinkView(), 201);
    const created = await createLocalPaymentLink({
      intentId: '11111111-1111-4111-8111-111111111124',
      amount: 24.9,
      message: 'Pedido 1048',
      expirationMinutes: 15,
      payerIdentityType: 'dni',
      payerDni: '45382026',
    });
    requests = [];
    responder = () => success(paymentLinkView({ status: 'canceled', updatedAt: '2026-09-09T12:04:00.000Z' }));

    const canceled = await cancelLocalPaymentLink(created.paymentLink.id);
    expect(canceled.status).toBe('canceled');
    expect(requests.map(request => `${request.init.method} ${new URL(request.url).pathname}`)).toEqual([
      'POST /api/v1/client/payment-links/link-1/cancel',
    ]);
    expect((await exampleRepository.readPaymentLinks())[0]?.status).toBe('canceled');
  });

  test('persists a stable intent before create and recovers an ambiguous success without a duplicate POST', async () => {
    const intentId = '11111111-1111-4111-8111-111111111125';
    const input = {
      intentId,
      amount: 24.9,
      message: 'Pedido ambiguo',
      expirationMinutes: 15,
      payerIdentityType: 'name' as const,
      payerName: 'Cliente de Prueba',
    };
    let createdRemotely = false;
    responder = request => {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/api/v1/client/payment-links') {
        createdRemotely = true;
        return new Response(JSON.stringify({ success: false }), { status: 502 });
      }
      if (pathname.includes('/external/') && createdRemotely) return success(paymentLinkView());
      return new Response(JSON.stringify({ success: false, code: 'NOT_FOUND' }), { status: 404 });
    };

    await expect(createLocalPaymentLink(input)).rejects.toMatchObject({ code: 'ALTOKEPAY_UNAVAILABLE' });
    const pending = (await exampleRepository.readPaymentLinkIntents())[0];
    expect(pending).toMatchObject({ intentId, status: 'pending' });
    const externalId = pending?.externalId;
    if (!externalId) throw new Error('Missing persisted externalId');
    requests = [];

    const recovered = await createLocalPaymentLink(input);

    expect(recovered.publicUrl).toBe(publicUrl);
    expect(recovered.paymentLink.externalId).toBe(externalId);
    expect(requests.map(request => `${request.init.method ?? 'GET'} ${new URL(request.url).pathname}`)).toEqual([
      `GET /api/v1/client/payment-links/external/${externalId}`,
    ]);
    expect((await exampleRepository.readPaymentLinkIntents())[0]).toMatchObject({ status: 'completed' });
  });

  test('recovers a stored public URL only through the explicit local action', async () => {
    responder = request => success(paymentLinkView(bodyOf(request)), 201);
    const created = await createLocalPaymentLink({
      intentId: '11111111-1111-4111-8111-111111111126',
      amount: 24.9,
      message: 'Pedido 1048',
      expirationMinutes: 15,
      payerIdentityType: 'name',
      payerName: 'Cliente de Prueba',
    });

    expect(await recoverLocalPaymentLinkPublicUrl(created.paymentLink.id)).toEqual({ publicUrl });
    const response = await createApp().request(`/api/payment-links/${created.paymentLink.id}/recover-public-url`, {
      method: 'POST',
      headers: { Authorization: merchantAuthorization },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ publicUrl });
    expect(await listLocalPaymentLinks()).not.toContainEqual(expect.objectContaining({ publicUrl }));
  });

  test('keeps the merchant panel separate from Checkout and uses only the local collection route', async () => {
    const checkoutSource = await readFile(new URL('../public/checkout.js', import.meta.url), 'utf8');
    const storeSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
    const panelSource = await readFile(new URL('../public/payment-links.js', import.meta.url), 'utf8');
    const routeSource = await readFile(new URL('../src/routes/paymentLinkRoutes.ts', import.meta.url), 'utf8');
    const serviceSource = await readFile(
      new URL('../src/services/merchantPaymentLinkService.ts', import.meta.url),
      'utf8',
    );

    expect(checkoutSource).not.toContain('/api/payment-links');
    expect(storeSource).toContain("window.location.href = '/payment-links.html'");
    expect(panelSource).toContain("requestJson('/api/payment-links')");
    expect(panelSource).toContain('/recover-public-url');
    expect(panelSource).not.toContain('/api/session/payer');
    expect(panelSource).not.toContain('setInterval');
    expect(panelSource).not.toContain('localStorage');
    expect(panelSource).not.toContain('sessionStorage');
    expect(routeSource).toContain(".get('/api/payment-links'");
    expect(routeSource).not.toContain(".get('/api/v1/client/payment-links'");
    expect(routeSource).not.toContain('/api/orders');
    expect(routeSource).not.toContain('/api/session/payer');
    expect(routeSource).toContain('/recover-public-url');
    expect(serviceSource).toContain('exampleRepository.readPaymentLinks()');
  });
});
