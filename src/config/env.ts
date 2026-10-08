import * as v from 'valibot';
import type { Environment } from '#domain/types';

const merchantUsernameSchema = v.pipe(
  v.string(),
  v.minLength(3),
  v.maxLength(64),
  v.regex(/^[^\s:\u0000-\u001f\u007f]+$/),
);
const merchantPasswordSchema = v.pipe(
  v.string(),
  v.minLength(16),
  v.maxLength(256),
  v.regex(/^[^\u0000-\u001f\u007f]+$/),
);

const envSchema = v.object({
  ALTOKEPAY_BASE_URL: v.optional(v.pipe(v.string(), v.url())),
  ALTOKEPAY_API_KEY: v.optional(v.pipe(v.string(), v.trim()), ''),
  ALTOKEPAY_WEBHOOK_SECRET: v.optional(v.pipe(v.string(), v.trim()), ''),
  ALTOKEPAY_ENVIRONMENT: v.optional(v.picklist(['production', 'sandbox'])),
  EXAMPLE_PORT: v.optional(v.pipe(v.string(), v.regex(/^\d+$/))),
  EXAMPLE_PUBLIC_URL: v.optional(v.pipe(v.string(), v.url())),
  EXAMPLE_MERCHANT_USERNAME: v.optional(v.string(), ''),
  EXAMPLE_MERCHANT_PASSWORD: v.optional(v.string(), ''),
});

export type ExampleRuntimeConfig = {
  readonly ALTOKEPAY_BASE_URL?: string | undefined;
  readonly ALTOKEPAY_API_KEY: string;
  readonly ALTOKEPAY_WEBHOOK_SECRET: string;
  readonly ALTOKEPAY_ENVIRONMENT?: Environment | undefined;
  readonly EXAMPLE_PORT?: string | undefined;
  readonly EXAMPLE_PUBLIC_URL?: string | undefined;
  readonly EXAMPLE_MERCHANT_USERNAME: string;
  readonly EXAMPLE_MERCHANT_PASSWORD: string;
};

export const env: ExampleRuntimeConfig = v.parse(envSchema, {
  ALTOKEPAY_BASE_URL: process.env.ALTOKEPAY_BASE_URL,
  ALTOKEPAY_API_KEY: process.env.ALTOKEPAY_API_KEY,
  ALTOKEPAY_WEBHOOK_SECRET: process.env.ALTOKEPAY_WEBHOOK_SECRET,
  ALTOKEPAY_ENVIRONMENT: process.env.ALTOKEPAY_ENVIRONMENT,
  EXAMPLE_PORT: process.env.EXAMPLE_PORT,
  EXAMPLE_PUBLIC_URL: process.env.EXAMPLE_PUBLIC_URL,
  EXAMPLE_MERCHANT_USERNAME: process.env.EXAMPLE_MERCHANT_USERNAME,
  EXAMPLE_MERCHANT_PASSWORD: process.env.EXAMPLE_MERCHANT_PASSWORD,
});

export const hasValidMerchantCredentials = (
  config: Pick<ExampleRuntimeConfig, 'EXAMPLE_MERCHANT_USERNAME' | 'EXAMPLE_MERCHANT_PASSWORD'>,
): boolean =>
  v.safeParse(merchantUsernameSchema, config.EXAMPLE_MERCHANT_USERNAME).success &&
  v.safeParse(merchantPasswordSchema, config.EXAMPLE_MERCHANT_PASSWORD).success;

export function assertExampleRuntimeConfig(
  config: ExampleRuntimeConfig,
): asserts config is Required<ExampleRuntimeConfig> {
  const values: ReadonlyArray<readonly [keyof ExampleRuntimeConfig, string | undefined]> = [
    ['ALTOKEPAY_BASE_URL', config.ALTOKEPAY_BASE_URL],
    ['ALTOKEPAY_API_KEY', config.ALTOKEPAY_API_KEY],
    ['ALTOKEPAY_WEBHOOK_SECRET', config.ALTOKEPAY_WEBHOOK_SECRET],
    ['ALTOKEPAY_ENVIRONMENT', config.ALTOKEPAY_ENVIRONMENT],
    ['EXAMPLE_PORT', config.EXAMPLE_PORT],
    ['EXAMPLE_PUBLIC_URL', config.EXAMPLE_PUBLIC_URL],
    ['EXAMPLE_MERCHANT_USERNAME', config.EXAMPLE_MERCHANT_USERNAME],
    ['EXAMPLE_MERCHANT_PASSWORD', config.EXAMPLE_MERCHANT_PASSWORD],
  ];
  const missingNames = values.filter(([, value]) => !value).map(([name]) => name);
  if (missingNames.length > 0) throw new Error(`Missing required example configuration: ${missingNames.join(', ')}`);

  const invalidNames: Array<keyof ExampleRuntimeConfig> = [];
  const usernameValid = v.safeParse(merchantUsernameSchema, config.EXAMPLE_MERCHANT_USERNAME).success;
  const passwordValid = v.safeParse(merchantPasswordSchema, config.EXAMPLE_MERCHANT_PASSWORD).success;
  if (!usernameValid) invalidNames.push('EXAMPLE_MERCHANT_USERNAME');
  if (!passwordValid) invalidNames.push('EXAMPLE_MERCHANT_PASSWORD');
  if (invalidNames.length > 0) throw new Error(`Invalid example configuration: ${invalidNames.join(', ')}`);
}
