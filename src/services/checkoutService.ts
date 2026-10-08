import * as v from 'valibot';
import type { CheckoutMethod } from '#domain/types';
import { HttpError } from '#lib/httpError';
import { requestAltokePay } from '#services/altokePayClient';

const requiredText = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500));
const currencySchema = v.pipe(v.string(), v.regex(/^[A-Z]{3}$/));
const checkoutStatusSchema = v.picklist(['awaiting_payment', 'paid', 'expired', 'canceled']);
const walletSchema = v.object({
  id: requiredText,
  code: requiredText,
  name: requiredText,
  iconUrl: v.optional(v.pipe(v.string(), v.url())),
  icon: v.optional(v.object({ secureUrl: v.optional(v.pipe(v.string(), v.url())) })),
});
const paymentExpectationSchema = v.object({ message: requiredText });
const checkoutAssetSchema = v.object({ secureUrl: v.optional(v.pipe(v.string(), v.url())) });
const checkoutViewSchema = v.object({
  id: requiredText,
  externalId: requiredText,
  providerCode: requiredText,
  acceptedWalletId: v.optional(requiredText),
  acceptedWallet: v.optional(walletSchema),
  paymentExpectation: v.optional(paymentExpectationSchema),
  matchingMode: v.optional(requiredText),
  amount: v.number(),
  currency: currencySchema,
  status: checkoutStatusSchema,
  expiresAt: v.optional(requiredText),
  checkoutAsset: v.optional(checkoutAssetSchema),
});
const cancelViewSchema = v.object({
  checkout: checkoutViewSchema,
  changed: v.boolean(),
});
const retryViewSchema = v.object({ checkout: checkoutViewSchema });
const checkoutMethodSchema = v.object({
  providerCode: requiredText,
  displayName: requiredText,
  currencies: v.array(currencySchema),
  iconUrl: v.optional(v.pipe(v.string(), v.url())),
  acceptedWallets: v.array(walletSchema),
});

export type CheckoutView = v.InferOutput<typeof checkoutViewSchema>;
export type CheckoutRetryView = { readonly checkout: CheckoutView };
export type CheckoutCancelView = { readonly checkout: CheckoutView; readonly changed: boolean };

const parseCheckoutResponse = <TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
  value: unknown,
): v.InferOutput<TSchema> => {
  const parsed = v.safeParse(schema, value);
  if (!parsed.success) {
    throw new HttpError(502, 'ALTOKEPAY_CHECKOUT_MISMATCH', 'AltokePay devolvió un Checkout inconsistente.');
  }
  return parsed.output;
};

export const createCheckout = async (input: unknown): Promise<CheckoutView> =>
  parseCheckoutResponse(
    checkoutViewSchema,
    await requestAltokePay<unknown>('/api/v1/client/checkouts', { method: 'POST', body: JSON.stringify(input) }),
  );

export const findCheckoutByExternalId = async (externalId: string): Promise<CheckoutView> =>
  parseCheckoutResponse(
    checkoutViewSchema,
    await requestAltokePay<unknown>(`/api/v1/client/checkouts/external/${encodeURIComponent(externalId)}`),
  );

export const findCheckoutById = async (checkoutId: string): Promise<CheckoutView> =>
  parseCheckoutResponse(
    checkoutViewSchema,
    await requestAltokePay<unknown>(`/api/v1/client/checkouts/${encodeURIComponent(checkoutId)}`),
  );

export const findCheckoutStatusById = async (checkoutId: string): Promise<CheckoutView> =>
  parseCheckoutResponse(
    checkoutViewSchema,
    await requestAltokePay<unknown>(`/api/v1/client/checkouts/${encodeURIComponent(checkoutId)}/status`),
  );

export const cancelCheckout = async (checkoutId: string): Promise<CheckoutCancelView> =>
  parseCheckoutResponse(
    cancelViewSchema,
    await requestAltokePay<unknown>(`/api/v1/client/checkouts/${encodeURIComponent(checkoutId)}/cancel`, {
      method: 'POST',
    }),
  );

export const retryCheckout = async (checkoutId: string, input: unknown): Promise<CheckoutRetryView> =>
  parseCheckoutResponse(
    retryViewSchema,
    await requestAltokePay<unknown>(`/api/v1/client/checkouts/${encodeURIComponent(checkoutId)}/retry`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );

export const findCheckoutMethods = async (): Promise<CheckoutMethod[]> => {
  const parsed = v.safeParse(
    v.array(checkoutMethodSchema),
    await requestAltokePay<unknown>('/api/v1/client/payment-methods/checkout'),
  );
  if (!parsed.success) {
    throw new HttpError(502, 'ALTOKEPAY_PAYMENT_METHOD_MISMATCH', 'AltokePay devolvió métodos de pago inconsistentes.');
  }
  return parsed.output;
};
