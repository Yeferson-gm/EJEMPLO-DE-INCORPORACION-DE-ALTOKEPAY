import * as v from 'valibot';

export const payerInputSchema = v.strictObject({
  dni: v.pipe(v.string(), v.trim(), v.regex(/^\d{8}$/)),
});

export type PayerInput = v.InferOutput<typeof payerInputSchema>;

export type DemoPayer = PayerInput & {
  readonly id: string;
  readonly createdAt: string;
};

export type PayerSession = {
  readonly tokenHash: string;
  readonly payer: DemoPayer;
  readonly expiresAt: string;
};

export const payerProjection = { configured: true } as const;
