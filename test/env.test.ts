import { describe, expect, test } from 'bun:test';
import { assertExampleRuntimeConfig, type ExampleRuntimeConfig } from '#config/env';

const completeConfig: ExampleRuntimeConfig = {
  ALTOKEPAY_BASE_URL: 'http://localhost:3000',
  ALTOKEPAY_API_KEY: 'api-key',
  ALTOKEPAY_WEBHOOK_SECRET: 'webhook-secret',
  ALTOKEPAY_ENVIRONMENT: 'sandbox',
  EXAMPLE_PORT: '3001',
  EXAMPLE_PUBLIC_URL: 'http://localhost:3001',
  EXAMPLE_MERCHANT_USERNAME: 'merchant-demo',
  EXAMPLE_MERCHANT_PASSWORD: 'correct-horse-battery-staple',
};

describe('example runtime configuration', () => {
  test('accepts complete configuration', () => {
    expect(() => assertExampleRuntimeConfig(completeConfig)).not.toThrow();
  });

  test('rejects merchant credentials below the configured minimums without exposing their values', () => {
    expect(() =>
      assertExampleRuntimeConfig({
        ...completeConfig,
        EXAMPLE_MERCHANT_USERNAME: 'ab',
        EXAMPLE_MERCHANT_PASSWORD: 'short',
      }),
    ).toThrow('Invalid example configuration: EXAMPLE_MERCHANT_USERNAME, EXAMPLE_MERCHANT_PASSWORD');
  });

  test('reports all missing values', () => {
    expect(() =>
      assertExampleRuntimeConfig({
        ...completeConfig,
        ALTOKEPAY_WEBHOOK_SECRET: '',
        ALTOKEPAY_ENVIRONMENT: undefined,
        EXAMPLE_PUBLIC_URL: undefined,
        EXAMPLE_MERCHANT_USERNAME: '',
        EXAMPLE_MERCHANT_PASSWORD: '',
      }),
    ).toThrow(
      'Missing required example configuration: ALTOKEPAY_WEBHOOK_SECRET, ALTOKEPAY_ENVIRONMENT, EXAMPLE_PUBLIC_URL, EXAMPLE_MERCHANT_USERNAME, EXAMPLE_MERCHANT_PASSWORD',
    );
  });
});
