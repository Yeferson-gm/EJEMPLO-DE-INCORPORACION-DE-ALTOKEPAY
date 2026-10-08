import * as v from 'valibot';
import { exampleRepository } from '#data/exampleRepository';
import type {
  CreateLocalPaymentLinkInput,
  PaymentLinkIntent,
  PaymentLinkListItem,
  PaymentLinkRecord,
} from '#domain/paymentLink';
import { HttpError } from '#lib/httpError';
import { buildExternalId, fingerprintJson } from '#lib/id';
import {
  cancelPaymentLink,
  createPaymentLink,
  findPaymentLinkByExternalId,
  findPaymentLinkById,
  findPaymentLinkStatusById,
} from '#services/paymentLinkService';

const requiredText = v.pipe(v.string(), v.trim(), v.minLength(1));
const paymentLinkStatusSchema = v.picklist(['awaiting_payment', 'paid', 'expired', 'canceled']);
const paymentLinkViewSchema = v.object({
  id: requiredText,
  amount: v.number(),
  currency: v.literal('PEN'),
  message: requiredText,
  publicUrl: v.pipe(v.string(), v.url()),
  status: paymentLinkStatusSchema,
  expiresAt: requiredText,
  createdAt: requiredText,
  updatedAt: requiredText,
});
const paymentLinkStatusViewSchema = v.object({
  id: requiredText,
  status: paymentLinkStatusSchema,
  expiresAt: requiredText,
  updatedAt: requiredText,
});

type PaymentLinkView = v.InferOutput<typeof paymentLinkViewSchema>;
type CreationResult = { readonly paymentLink: PaymentLinkListItem; readonly publicUrl: string };

const parseUpstream = <TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(
  schema: TSchema,
  value: unknown,
): v.InferOutput<TSchema> => {
  const result = v.safeParse(schema, value);
  if (!result.success) {
    throw new HttpError(502, 'ALTOKEPAY_PAYMENT_LINK_MISMATCH', 'AltokePay devolvió un Link de pago inconsistente.');
  }
  return result.output;
};

const assertPublicUrl = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(502, 'INVALID_PAYMENT_LINK_URL', 'AltokePay devolvió una URL de pago inválida.');
  }
  return value;
};

const toRecord = (externalId: string, link: PaymentLinkView): PaymentLinkRecord => ({
  id: link.id,
  externalId,
  amount: link.amount,
  currency: link.currency,
  message: link.message,
  publicUrl: assertPublicUrl(link.publicUrl),
  status: link.status,
  expiresAt: link.expiresAt,
  createdAt: link.createdAt,
  updatedAt: link.updatedAt,
});

const toListItem = (record: PaymentLinkRecord): PaymentLinkListItem => {
  const { publicUrl: _publicUrl, ...item } = record;
  return item;
};

const requireLocalPaymentLink = async (id: string): Promise<PaymentLinkRecord> => {
  const record = (await exampleRepository.readPaymentLinks()).find(link => link.id === id);
  if (!record) throw new HttpError(404, 'PAYMENT_LINK_NOT_FOUND', 'No encontramos el Link de pago solicitado.');
  return record;
};

const replacePaymentLink = (record: PaymentLinkRecord): Promise<PaymentLinkRecord> =>
  exampleRepository.mutatePaymentLinks(records => {
    const withoutCurrent = records.filter(
      current => current.id !== record.id && current.externalId !== record.externalId,
    );
    return [[record, ...withoutCurrent], record] as const;
  });

const createOrReadIntent = (
  input: CreateLocalPaymentLinkInput,
  requestFingerprint: string,
): Promise<{ readonly intent: PaymentLinkIntent; readonly created: boolean }> =>
  exampleRepository.mutatePaymentLinkIntents<{ readonly intent: PaymentLinkIntent; readonly created: boolean }>(
    intents => {
      const existing = intents.find(intent => intent.intentId === input.intentId);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new HttpError(
            409,
            'PAYMENT_LINK_INTENT_CONFLICT',
            'El intento de Link de pago ya existe con datos diferentes.',
          );
        }
        return [intents, { intent: existing, created: false }] as const;
      }
      const { intentId, ...creationData } = input;
      const now = new Date().toISOString();
      const intent: PaymentLinkIntent = {
        intentId,
        externalId: buildExternalId(),
        requestFingerprint,
        input: creationData,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      return [[intent, ...intents], { intent, created: true }] as const;
    },
  );

const completeIntent = (intent: PaymentLinkIntent, paymentLinkId: string): Promise<void> =>
  exampleRepository.mutatePaymentLinkIntents(
    intents =>
      [
        intents.map(current =>
          current.intentId === intent.intentId
            ? {
                ...current,
                input: null,
                status: 'completed' as const,
                paymentLinkId,
                updatedAt: new Date().toISOString(),
              }
            : current,
        ),
        undefined,
      ] as const,
  );

const recoverOrCreateRemoteLink = async (intent: PaymentLinkIntent, created: boolean): Promise<PaymentLinkView> => {
  if (!created) {
    try {
      return parseUpstream(paymentLinkViewSchema, await findPaymentLinkByExternalId<unknown>(intent.externalId));
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== 'NOT_FOUND') throw error;
    }
  }
  if (!intent.input) {
    throw new HttpError(
      409,
      'PAYMENT_LINK_INTENT_INCOMPLETE',
      'El intento no conserva datos para reintentar la creación.',
    );
  }
  return parseUpstream(
    paymentLinkViewSchema,
    await createPaymentLink<unknown>({ externalId: intent.externalId, ...intent.input }),
  );
};

const inFlightCreations = new Map<
  string,
  { readonly fingerprint: string; readonly promise: Promise<CreationResult> }
>();

export const listLocalPaymentLinks = async (): Promise<PaymentLinkListItem[]> =>
  (await exampleRepository.readPaymentLinks()).map(toListItem);

export const createLocalPaymentLink = (input: CreateLocalPaymentLinkInput): Promise<CreationResult> => {
  const { intentId, ...creationData } = input;
  const requestFingerprint = fingerprintJson(creationData);
  const current = inFlightCreations.get(intentId);
  if (current) {
    if (current.fingerprint !== requestFingerprint) {
      return Promise.reject(
        new HttpError(
          409,
          'PAYMENT_LINK_INTENT_CONFLICT',
          'El intento de Link de pago ya existe con datos diferentes.',
        ),
      );
    }
    return current.promise;
  }

  const promise = (async () => {
    const { intent, created } = await createOrReadIntent(input, requestFingerprint);
    if (intent.status === 'completed') {
      const completed = (await exampleRepository.readPaymentLinks()).find(
        link => link.externalId === intent.externalId,
      );
      if (completed) return { paymentLink: toListItem(completed), publicUrl: completed.publicUrl };
    }
    const link = await recoverOrCreateRemoteLink(intent, created);
    const record = await replacePaymentLink(toRecord(intent.externalId, link));
    await completeIntent(intent, record.id);
    return { paymentLink: toListItem(record), publicUrl: record.publicUrl };
  })();
  inFlightCreations.set(intentId, { fingerprint: requestFingerprint, promise });
  const clearInFlight = () => {
    if (inFlightCreations.get(intentId)?.promise === promise) inFlightCreations.delete(intentId);
  };
  void promise.then(clearInFlight, clearInFlight);
  return promise;
};

export const refreshLocalPaymentLink = async (id: string): Promise<PaymentLinkListItem> => {
  const local = await requireLocalPaymentLink(id);
  const [externalRaw, detailRaw, statusRaw] = await Promise.all([
    findPaymentLinkByExternalId<unknown>(local.externalId),
    findPaymentLinkById<unknown>(local.id),
    findPaymentLinkStatusById<unknown>(local.id),
  ]);
  const byExternalId = parseUpstream(paymentLinkViewSchema, externalRaw);
  const byId = parseUpstream(paymentLinkViewSchema, detailRaw);
  const status = parseUpstream(paymentLinkStatusViewSchema, statusRaw);
  if (byExternalId.id !== local.id || byId.id !== local.id || status.id !== local.id) {
    throw new HttpError(502, 'ALTOKEPAY_PAYMENT_LINK_MISMATCH', 'AltokePay devolvió un Link de pago inconsistente.');
  }
  return toListItem(
    await replacePaymentLink({
      ...toRecord(local.externalId, byId),
      status: status.status,
      expiresAt: status.expiresAt,
      updatedAt: status.updatedAt,
    }),
  );
};

export const cancelLocalPaymentLink = async (id: string): Promise<PaymentLinkListItem> => {
  const local = await requireLocalPaymentLink(id);
  if (local.status !== 'awaiting_payment') return toListItem(local);
  const canceled = parseUpstream(paymentLinkViewSchema, await cancelPaymentLink<unknown>(local.id));
  if (canceled.id !== local.id) {
    throw new HttpError(502, 'ALTOKEPAY_PAYMENT_LINK_MISMATCH', 'AltokePay devolvió un Link de pago inconsistente.');
  }
  return toListItem(await replacePaymentLink(toRecord(local.externalId, canceled)));
};

export const recoverLocalPaymentLinkPublicUrl = async (id: string): Promise<{ readonly publicUrl: string }> => {
  const local = await requireLocalPaymentLink(id);
  if (local.publicUrl) return { publicUrl: assertPublicUrl(local.publicUrl) };
  const recovered = parseUpstream(paymentLinkViewSchema, await findPaymentLinkByExternalId<unknown>(local.externalId));
  if (recovered.id !== local.id) {
    throw new HttpError(502, 'ALTOKEPAY_PAYMENT_LINK_MISMATCH', 'AltokePay devolvió un Link de pago inconsistente.');
  }
  const record = await replacePaymentLink(toRecord(local.externalId, recovered));
  return { publicUrl: record.publicUrl };
};
