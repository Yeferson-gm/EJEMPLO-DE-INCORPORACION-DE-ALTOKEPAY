import { beforeEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import * as v from 'valibot';
import { createApp } from '#app';
import { exampleRepository } from '#data/exampleRepository';
import { products } from '#domain/catalog';
import { createLocalPaymentLinkSchema } from '#domain/paymentLink';

describe('versioned demo catalog', () => {
  beforeEach(async () => {
    await exampleRepository.mutatePayerSessions(() => [[], undefined] as const);
  });

  test('loads validated products without a versioned customer identity', async () => {
    expect(products.length).toBeGreaterThan(0);
    expect(new Set(products.map(product => product.id)).size).toBe(products.length);
    const catalogSource = await readFile(new URL('../src/domain/catalog.ts', import.meta.url), 'utf8');
    expect(catalogSource).not.toContain('customerConfig');
    expect(catalogSource).not.toContain('#configData/customer');
    expect(catalogSource).not.toContain('startPaymentLinkSchema');
  });

  test('validates the Payment Link contract independently from products', () => {
    expect(
      v.parse(createLocalPaymentLinkSchema, {
        intentId: '11111111-1111-4111-8111-111111111131',
        amount: 24.9,
        message: 'Pedido 1048',
        expirationMinutes: 15,
        payerIdentityType: 'dni',
        payerDni: '45382026',
      }),
    ).toMatchObject({ amount: 24.9, payerIdentityType: 'dni', payerDni: '45382026' });
    expect(
      v.parse(createLocalPaymentLinkSchema, {
        intentId: '11111111-1111-4111-8111-111111111132',
        amount: 24.9,
        message: '  Pedido   especial  ',
        expirationMinutes: 60,
        payerIdentityType: 'name',
        payerName: '  Cliente   de Prueba ',
      }),
    ).toMatchObject({ payerIdentityType: 'name', payerName: 'Cliente de Prueba' });
    expect(() =>
      v.parse(createLocalPaymentLinkSchema, {
        intentId: '11111111-1111-4111-8111-111111111133',
        amount: 24.999,
        message: 'Pedido',
        expirationMinutes: 15,
        payerIdentityType: 'dni',
        payerDni: '45382026',
      }),
    ).toThrow();
    expect(() =>
      v.parse(createLocalPaymentLinkSchema, {
        intentId: '11111111-1111-4111-8111-111111111134',
        amount: 24.9,
        message: 'Pedido',
        expirationMinutes: 0,
        payerIdentityType: 'name',
        payerName: 'Cliente',
      }),
    ).toThrow();
  });

  test('creates a private payer session with a server-owned UUID and DNI only', async () => {
    const response = await createApp().request('/api/session/payer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dni: '45382026' }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(await response.json()).toEqual({ payer: { configured: true } });

    const sessions = await exampleRepository.readPayerSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sessions[0]?.payer).toMatchObject({ dni: '45382026' });
    expect(sessions[0]?.payer).not.toHaveProperty('firstName');
    expect(sessions[0]?.payer).not.toHaveProperty('lastName');
    expect(sessions[0]?.payer).not.toHaveProperty('email');
    expect(sessions[0]?.payer.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  test('returns only a boolean-safe projection for the HttpOnly payer session', async () => {
    const app = createApp();
    const created = await app.request('/api/session/payer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dni: '45382026' }),
    });
    const cookie = created.headers.get('set-cookie')?.split(';', 1)[0];
    if (!cookie) throw new Error('Missing payer cookie');

    const response = await app.request('/api/session/payer', { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ payer: { configured: true } });
  });
});
