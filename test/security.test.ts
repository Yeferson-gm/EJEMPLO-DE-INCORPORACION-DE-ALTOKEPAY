import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createApp } from '#app';
import { requiredClientScopes } from '#config/constants';
import { env } from '#config/env';
import { exampleRepository } from '#data/exampleRepository';
import { logoutAltokePayClient, requestAltokePay, validateAltokePayClient } from '#services/altokePayClient';
import { verifyAltokePayWebhookRequest } from '#services/webhookSignatureService';
import { configureTestEnvironment } from './testConfig';

const originalFetch = globalThis.fetch;
const merchantUsername = 'merchant-demo';
const merchantPassword = 'correct-horse-battery-staple';
const basicAuthorization = (username = merchantUsername, password = merchantPassword): string =>
  `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;

beforeEach(async () => {
  configureTestEnvironment();
  Object.assign(env, {
    ALTOKEPAY_ENVIRONMENT: env.ALTOKEPAY_ENVIRONMENT ?? 'sandbox',
    EXAMPLE_MERCHANT_USERNAME: merchantUsername,
    EXAMPLE_MERCHANT_PASSWORD: merchantPassword,
  });
  await exampleRepository.writeTokens({
    accessToken: 'access-token',
    accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('merchant Payment Link HTTP Basic authentication', () => {
  test('rejects missing credentials without redirecting', async () => {
    const response = await createApp().request('/payment-links.html');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Basic realm="AltokePay Merchant", charset="UTF-8"');
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toBe('Unauthorized');
  });

  test('rejects malformed and invalid credentials with the same generic challenge', async () => {
    for (const authorization of [
      'Bearer token',
      'Basic not-base64!',
      basicAuthorization('wrong-user', merchantPassword),
      basicAuthorization(merchantUsername, 'wrong-password-value'),
    ]) {
      const response = await createApp().request('/api/payment-links', { headers: { Authorization: authorization } });
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Basic realm="AltokePay Merchant", charset="UTF-8"');
      expect(await response.text()).toBe('Unauthorized');
    }
  });

  test('fails closed when merchant configuration does not meet the minimums', async () => {
    Object.assign(env, { EXAMPLE_MERCHANT_PASSWORD: 'short' });
    const response = await createApp().request('/payment-links.html', {
      headers: { Authorization: basicAuthorization(merchantUsername, 'short') },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Basic realm=');
  });

  test('accepts valid credentials for the merchant page, HEAD, and Payment Link APIs', async () => {
    const headers = { Authorization: basicAuthorization() };
    const page = await createApp().request('/payment-links.html', { headers });
    const head = await createApp().request('/payment-links.html', { method: 'HEAD', headers });
    const api = await createApp().request('/api/payment-links', { headers });

    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>Links de pago · AltokePay Store</title>');
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(api.status).toBe(200);
    expect(await api.json()).toHaveProperty('paymentLinks');
  });

  test('protects HEAD and every Payment Link API action before routing or static fallback', async () => {
    const pageHead = await createApp().request('/payment-links.html', { method: 'HEAD' });
    const encodedPage = await createApp().request('/payment-links%2Ehtml');
    const apiAction = await createApp().request('/api/payment-links/link-1/recover-public-url', { method: 'POST' });

    expect(pageHead.status).toBe(401);
    expect(pageHead.headers.get('www-authenticate')).toContain('Basic realm=');
    expect(await pageHead.text()).toBe('');
    expect(encodedPage.status).toBe(401);
    expect(encodedPage.headers.get('www-authenticate')).toContain('Basic realm=');
    expect(apiAction.status).toBe(401);
    expect(apiAction.headers.get('www-authenticate')).toContain('Basic realm=');
  });

  test('does not protect the public store, assets, Checkout APIs, webhooks, or lookalike paths', async () => {
    const app = createApp();
    const [store, asset, checkoutApi, webhook, lookalike] = await Promise.all([
      app.request('/'),
      app.request('/styles.css'),
      app.request('/api/products'),
      app.request('/webhooks/altokepay', { method: 'POST' }),
      app.request('/api/payment-links-not-merchant'),
    ]);

    expect(store.status).toBe(200);
    expect(asset.status).toBe(200);
    expect(checkoutApi.status).toBe(200);
    expect(webhook.status).not.toBe(401);
    expect(webhook.headers.get('www-authenticate')).toBeNull();
    expect(lookalike.status).toBe(404);
    expect(lookalike.headers.get('www-authenticate')).toBeNull();
  });
});

describe('OAuth client security', () => {
  test('does not allow callers to override Authorization', async () => {
    expect(
      requestAltokePay('/api/v1/client/checkouts/id', { headers: { Authorization: 'Bearer attacker' } }),
    ).rejects.toMatchObject({ code: 'UNSAFE_AUTHORIZATION_OVERRIDE' });
  });

  test('validates scopes and environment through client auth me', async () => {
    const calls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: { scopes: requiredClientScopes, environment: env.ALTOKEPAY_ENVIRONMENT },
          }),
          { status: 200 },
        ),
      );
    }) as unknown as typeof fetch;
    await validateAltokePayClient();
    expect(calls.map(value => new URL(value).pathname)).toEqual(['/api/v1/client/auth/me']);
  });

  test('recovers a revoked but unexpired access token during startup validation', async () => {
    await exampleRepository.writeTokens({
      accessToken: 'revoked-access',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
    });
    let refreshCalls = 0;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input)).pathname;
      const authorization = new Headers(init?.headers).get('authorization');
      if (pathname === '/oauth/token') {
        refreshCalls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                accessToken: 'refreshed-access',
                refreshToken: 'next-refresh',
                accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
              },
            }),
          ),
        );
      }
      if (pathname === '/api/v1/client/auth/me' && authorization === 'Bearer revoked-access') {
        return Promise.resolve(new Response('{}', { status: 401 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: { scopes: requiredClientScopes, environment: env.ALTOKEPAY_ENVIRONMENT },
          }),
        ),
      );
    }) as unknown as typeof fetch;

    await validateAltokePayClient();

    expect(refreshCalls).toBe(1);
    expect((await exampleRepository.readTokens()).accessToken).toBe('refreshed-access');
  });

  test('uses a single refresh for concurrent expired-token requests', async () => {
    await exampleRepository.writeTokens({
      accessToken: 'expired',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: '2000-01-01T00:00:00.000Z',
    });
    let refreshCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === '/oauth/token') {
        refreshCalls += 1;
        await Bun.sleep(5);
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              accessToken: 'refreshed-access',
              refreshToken: 'next-refresh',
              accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
            },
          }),
        );
      }
      if (pathname === '/api/v1/client/auth/me') {
        return new Response(
          JSON.stringify({
            success: true,
            data: { scopes: requiredClientScopes, environment: env.ALTOKEPAY_ENVIRONMENT },
          }),
        );
      }
      return new Response(JSON.stringify({ success: true, data: { id: 'checkout-1' } }));
    }) as unknown as typeof fetch;
    await Promise.all([
      requestAltokePay('/api/v1/client/checkouts/checkout-1'),
      requestAltokePay('/api/v1/client/checkouts/checkout-1/status'),
    ]);
    expect(refreshCalls).toBe(1);
  });

  test('revokes and clears the server-side OAuth session through internal logout', async () => {
    await exampleRepository.writeTokens({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: '2999-01-01T00:00:00.000Z',
    });
    let logoutRequest: RequestInit | undefined;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      logoutRequest = init;
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch;
    await logoutAltokePayClient();
    expect(new Headers(logoutRequest?.headers).get('authorization')).toBe('Bearer access-token');
    expect(String(logoutRequest?.body)).toContain('refresh-token');
    expect(await exampleRepository.readTokens()).toEqual({});
  });

  test('does not expose an upstream response payload in errors', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: false, error: 'secret upstream detail' }), { status: 500 }),
      )) as unknown as typeof fetch;
    await expect(requestAltokePay('/api/v1/client/checkouts/id')).rejects.toMatchObject({
      code: 'ALTOKEPAY_UNAVAILABLE',
      message: 'AltokePay no está disponible temporalmente. Inténtalo nuevamente.',
    });
  });

  test('preserves allowlisted commercial errors without exposing upstream details', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: false,
            code: 'BILLING_PAYMENT_REQUIRED',
            error: 'private billing diagnostic',
            details: { internalStatementId: 'secret' },
          }),
          { status: 402 },
        ),
      )) as unknown as typeof fetch;

    await expect(requestAltokePay('/api/v1/client/checkouts')).rejects.toMatchObject({
      status: 402,
      code: 'BILLING_PAYMENT_REQUIRED',
      message: 'AltokePay requiere regularizar la cuenta comercial antes de crear nuevos cobros.',
    });
  });

  test('does not trust unknown upstream codes or messages', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 'ATTACKER_CONTROLLED', error: 'sensitive upstream detail' }), {
          status: 409,
        }),
      )) as unknown as typeof fetch;

    await expect(requestAltokePay('/api/v1/client/checkouts')).rejects.toMatchObject({
      status: 502,
      code: 'ALTOKEPAY_UNAVAILABLE',
      message: 'AltokePay no está disponible temporalmente. Inténtalo nuevamente.',
    });
  });

  test('translates the safe identity-service code without exposing upstream details', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: false,
            code: 'IDENTITY_SERVICE_UNAVAILABLE',
            error: 'private provider diagnostic',
          }),
          { status: 503 },
        ),
      )) as unknown as typeof fetch;

    await expect(requestAltokePay('/api/v1/client/checkouts')).rejects.toMatchObject({
      status: 503,
      code: 'IDENTITY_SERVICE_UNAVAILABLE',
      message: 'No pudimos validar el DNI en este momento. Inténtalo nuevamente en unos minutos.',
    });
  });
});

describe('webhook signature verification', () => {
  test('requires environment and attempt and enforces the five-minute timestamp window', () => {
    const body = new TextEncoder().encode('{"id":"event-1"}');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', env.ALTOKEPAY_WEBHOOK_SECRET)
      .update(`${timestamp}.`, 'utf8')
      .update(body)
      .digest('hex');
    const headers = {
      'X-AltokePay-Webhook-Id': 'webhook-1',
      'X-AltokePay-Delivery-Id': 'delivery-1',
      'X-AltokePay-Event-Id': 'event-1',
      'X-AltokePay-Environment': 'sandbox',
      'X-AltokePay-Timestamp': timestamp,
      'X-AltokePay-Signature': signature,
      'X-AltokePay-Attempt': '1',
    };
    expect(verifyAltokePayWebhookRequest(new Request('http://localhost/webhooks', { headers }), body)).toMatchObject({
      eventId: 'event-1',
      environment: 'sandbox',
      attempt: 1,
    });
    const { 'X-AltokePay-Attempt': _attempt, ...missingAttempt } = headers;
    expect(
      verifyAltokePayWebhookRequest(new Request('http://localhost/webhooks', { headers: missingAttempt }), body),
    ).toBeNull();
    expect(
      verifyAltokePayWebhookRequest(
        new Request('http://localhost/webhooks', { headers }),
        body,
        Number(timestamp) + 301,
      ),
    ).toBeNull();
  });
});
