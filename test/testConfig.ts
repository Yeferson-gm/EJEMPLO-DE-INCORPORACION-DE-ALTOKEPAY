import { env } from '#config/env';

export const configureTestEnvironment = (): void => {
  Object.assign(env, {
    ALTOKEPAY_BASE_URL: 'https://api.altokepay.test',
    ALTOKEPAY_API_KEY: 'test-api-key',
    ALTOKEPAY_WEBHOOK_SECRET: 'test-webhook-secret',
    ALTOKEPAY_ENVIRONMENT: 'sandbox',
    EXAMPLE_PORT: '3001',
    EXAMPLE_PUBLIC_URL: 'https://example.altokepay.test',
    EXAMPLE_MERCHANT_USERNAME: 'merchant-demo',
    EXAMPLE_MERCHANT_PASSWORD: 'correct-horse-battery-staple',
  });
};
