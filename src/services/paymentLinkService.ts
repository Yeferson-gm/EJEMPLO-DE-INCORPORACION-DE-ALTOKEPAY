import { requestAltokePay } from '#services/altokePayClient';

type PaymentLinkCreationInput = { readonly externalId: string } & Record<string, unknown>;

export const createPaymentLink = <T>(input: PaymentLinkCreationInput): Promise<T> =>
  requestAltokePay<T>('/api/v1/client/payment-links', {
    method: 'POST',
    headers: { 'Idempotency-Key': input.externalId },
    body: JSON.stringify(input),
  });
export const findPaymentLinkByExternalId = <T>(externalId: string): Promise<T> =>
  requestAltokePay<T>(`/api/v1/client/payment-links/external/${encodeURIComponent(externalId)}`);
export const findPaymentLinkById = <T>(paymentLinkId: string): Promise<T> =>
  requestAltokePay<T>(`/api/v1/client/payment-links/${encodeURIComponent(paymentLinkId)}`);
export const findPaymentLinkStatusById = <T>(paymentLinkId: string): Promise<T> =>
  requestAltokePay<T>(`/api/v1/client/payment-links/${encodeURIComponent(paymentLinkId)}/status`);
export const cancelPaymentLink = <T>(paymentLinkId: string): Promise<T> =>
  requestAltokePay<T>(`/api/v1/client/payment-links/${encodeURIComponent(paymentLinkId)}/cancel`, { method: 'POST' });
