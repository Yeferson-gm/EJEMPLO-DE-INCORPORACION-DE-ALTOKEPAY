import * as v from 'valibot';

export type PaymentLinkStatus = 'awaiting_payment' | 'paid' | 'expired' | 'canceled';

export type PaymentLinkRecord = {
  readonly id: string;
  readonly externalId: string;
  readonly amount: number;
  readonly currency: 'PEN';
  readonly message: string;
  readonly publicUrl: string;
  readonly status: PaymentLinkStatus;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type PaymentLinkListItem = Omit<PaymentLinkRecord, 'publicUrl'>;

const amountSchema = v.pipe(
  v.number(),
  v.minValue(0.01),
  v.check(value => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8, 'El monto admite como máximo dos decimales'),
);
const messageSchema = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500));
const expirationMinutesSchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1440));
const payerDniSchema = v.pipe(v.string(), v.trim(), v.regex(/^\d{8}$/));
const payerNameSchema = v.pipe(
  v.string(),
  v.transform(value => value.trim().replace(/\s+/g, ' ')),
  v.minLength(3),
  v.maxLength(160),
);
const intentIdSchema = v.pipe(v.string(), v.uuid());

export const createLocalPaymentLinkSchema = v.variant('payerIdentityType', [
  v.strictObject({
    intentId: intentIdSchema,
    amount: amountSchema,
    message: messageSchema,
    expirationMinutes: expirationMinutesSchema,
    payerIdentityType: v.literal('dni'),
    payerDni: payerDniSchema,
  }),
  v.strictObject({
    intentId: intentIdSchema,
    amount: amountSchema,
    message: messageSchema,
    expirationMinutes: expirationMinutesSchema,
    payerIdentityType: v.literal('name'),
    payerName: payerNameSchema,
  }),
]);

export type CreateLocalPaymentLinkInput = v.InferOutput<typeof createLocalPaymentLinkSchema>;
export type PaymentLinkCreationData = Omit<CreateLocalPaymentLinkInput, 'intentId'>;
export type PaymentLinkIntent = {
  readonly intentId: string;
  readonly externalId: string;
  readonly requestFingerprint: string;
  readonly input: PaymentLinkCreationData | null;
  readonly status: 'pending' | 'completed';
  readonly paymentLinkId?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
};
