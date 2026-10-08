import * as v from 'valibot';
import { env } from '#config/env';
import { exampleRepository } from '#data/exampleRepository';
import { findProductById, type StartCheckoutInput } from '#domain/catalog';
import type { DemoPayer } from '#domain/payer';
import type { CheckoutMethod, Order, Wallet, WebhookReceipt, WebhookReceiptStatus } from '#domain/types';
import { HttpError } from '#lib/httpError';
import { buildExternalId, createOrderCapability, verifyOrderCapability } from '#lib/id';

import {
  type CheckoutView,
  cancelCheckout,
  createCheckout,
  findCheckoutByExternalId,
  findCheckoutById,
  findCheckoutMethods,
  findCheckoutStatusById,
  retryCheckout,
} from '#services/checkoutService';

const requiredText = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500));
const walletSchema = v.object({
  id: requiredText,
  code: requiredText,
  name: requiredText,
  iconUrl: v.optional(v.pipe(v.string(), v.url())),
  icon: v.optional(v.object({ secureUrl: v.optional(v.pipe(v.string(), v.url())) })),
});
const paymentExpectationSchema = v.object({ message: requiredText });
const checkoutAssetSchema = v.object({ secureUrl: v.optional(v.pipe(v.string(), v.url())) });
const paymentSchema = v.object({
  id: requiredText,
  providerCode: requiredText,
  amount: v.number(),
  currency: v.pipe(v.string(), v.regex(/^[A-Z]{3}$/)),
  status: requiredText,
  occurredAt: v.optional(requiredText),
  createdAt: v.optional(requiredText),
  senderName: v.optional(requiredText),
});
const checkoutSnapshotSchema = v.object({
  id: requiredText,
  externalId: requiredText,
  providerCode: requiredText,
  acceptedWalletId: v.optional(requiredText),
  acceptedWallet: v.optional(walletSchema),
  paymentExpectation: v.optional(paymentExpectationSchema),
  checkoutAsset: v.optional(checkoutAssetSchema),
  amount: v.number(),
  currency: v.pipe(v.string(), v.regex(/^[A-Z]{3}$/)),
  status: requiredText,
  expiresAt: v.optional(requiredText),
});
export const webhookEnvelopeSchema = v.object({
  id: requiredText,
  type: requiredText,
  environment: v.picklist(['production', 'sandbox']),
  livemode: v.boolean(),
  createdAt: requiredText,
  data: v.unknown(),
});
const webhookEnvironmentSchema = v.picklist(['production', 'sandbox']);
const checkoutWebhookBase = {
  id: requiredText,
  environment: webhookEnvironmentSchema,
  livemode: v.boolean(),
  createdAt: requiredText,
};
const checkoutWebhookSchema = v.variant('type', [
  v.object({
    ...checkoutWebhookBase,
    type: v.literal('checkout.created'),
    data: v.object({ checkout: checkoutSnapshotSchema }),
  }),
  v.object({
    ...checkoutWebhookBase,
    type: v.literal('checkout.paid'),
    data: v.object({ checkout: checkoutSnapshotSchema, payment: paymentSchema }),
  }),
  v.object({
    ...checkoutWebhookBase,
    type: v.literal('checkout.expired'),
    data: v.object({ checkout: checkoutSnapshotSchema }),
  }),
  v.object({
    ...checkoutWebhookBase,
    type: v.literal('checkout.canceled'),
    data: v.object({ checkout: checkoutSnapshotSchema }),
  }),
  v.object({
    ...checkoutWebhookBase,
    type: v.literal('checkout.retry_created'),
    data: v.object({
      checkout: checkoutSnapshotSchema,
      retry: v.object({ retryOfCheckoutId: requiredText, retryOfExternalId: requiredText }),
    }),
  }),
]);
const paymentReceivedWebhookSchema = v.object({
  ...checkoutWebhookBase,
  type: v.literal('payment.received'),
  data: v.object({ payment: v.object({ ...paymentSchema.entries, status: v.literal('processed') }) }),
});
const webhookPingSchema = v.object({
  ...checkoutWebhookBase,
  type: v.literal('webhook.ping'),
  data: v.object({
    message: requiredText,
    endpoint: v.object({ id: requiredText, name: requiredText, url: v.pipe(v.string(), v.url()) }),
    organizationId: requiredText,
  }),
});

export type CheckoutWebhookPayload = v.InferOutput<typeof checkoutWebhookSchema>;

const terminalReceiptStatuses = new Set<WebhookReceiptStatus>(['processed', 'ignored_unsupported']);
const supportedWebhookTypes = new Set([
  'checkout.created',
  'checkout.paid',
  'checkout.expired',
  'checkout.canceled',
  'checkout.retry_created',
  'payment.received',
  'webhook.ping',
]);
const expectedStatuses: Record<CheckoutWebhookPayload['type'], string> = {
  'checkout.created': 'awaiting_payment',
  'checkout.paid': 'paid',
  'checkout.expired': 'expired',
  'checkout.canceled': 'canceled',
  'checkout.retry_created': 'awaiting_payment',
};

const normalizeWallet = (wallet: Wallet | undefined | null): Wallet | null => {
  if (!wallet) return null;
  const iconUrl = wallet.iconUrl ?? wallet.icon?.secureUrl;
  return iconUrl ? { ...wallet, iconUrl } : wallet;
};

const normalizeCheckoutMethod = (method: CheckoutMethod): CheckoutMethod => ({
  ...method,
  acceptedWallets: method.acceptedWallets.map(wallet => normalizeWallet(wallet)).filter(wallet => wallet !== null),
});

const publicOrder = (order: Order | null): Omit<Order, 'orderTokenHash'> | null => {
  if (!order) return null;
  const { orderTokenHash: _orderTokenHash, ...safeOrder } = order;
  return safeOrder;
};

const addOrder = (order: Order): Promise<void> =>
  exampleRepository.mutateOrders(orders => [[order, ...orders], undefined] as const);

const removeOrder = (orderId: string): Promise<void> =>
  exampleRepository.mutateOrders(orders => [orders.filter(order => order.id !== orderId), undefined] as const);

export const findOrderById = async (orderId: string): Promise<Order | null> =>
  (await exampleRepository.readOrders()).find(order => order.id === orderId) ?? null;

export const findAuthorizedOrder = async (
  orderId: string,
  token: string,
): Promise<Omit<Order, 'orderTokenHash'> | null> => {
  const order = await findOrderById(orderId);
  if (!order) return null;
  if (!order.orderTokenHash || !verifyOrderCapability(token, order.orderTokenHash)) {
    throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  return publicOrder(order);
};

const requireAuthorizedStoredOrder = async (orderId: string, token: string): Promise<Order> => {
  const order = await findOrderById(orderId);
  if (!order?.orderTokenHash || !verifyOrderCapability(token, order.orderTokenHash)) {
    throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  return order;
};

export const refreshAuthorizedCheckoutOrder = async (
  orderId: string,
  token: string,
): Promise<Omit<Order, 'orderTokenHash'>> => {
  const order = await requireAuthorizedStoredOrder(orderId, token);
  if (!order.checkoutId || order.paymentMode !== 'checkout') {
    throw new HttpError(409, 'CHECKOUT_NOT_AVAILABLE', 'Order has no standard checkout session');
  }

  const [byExternalId, byId, status] = await Promise.all([
    findCheckoutByExternalId(order.externalId),
    findCheckoutById(order.checkoutId),
    findCheckoutStatusById(order.checkoutId),
  ]);
  const matchesOrder = [byExternalId, byId, status].every(
    checkout => checkout.id === order.checkoutId && checkout.externalId === order.externalId,
  );
  if (!matchesOrder) {
    throw new HttpError(502, 'ALTOKEPAY_CHECKOUT_MISMATCH', 'AltokePay returned an inconsistent checkout');
  }

  const recoveredPaymentStatus =
    status.status === 'expired' || status.status === 'canceled' ? status.status : order.paymentStatus;
  const updated = await updateOrder(order.id, {
    providerCode: byId.providerCode,
    acceptedWalletId: byId.acceptedWalletId ?? byId.acceptedWallet?.id ?? order.acceptedWalletId ?? null,
    acceptedWallet: normalizeWallet(byId.acceptedWallet ?? order.acceptedWallet),
    paymentExpectation: byId.paymentExpectation ?? order.paymentExpectation ?? null,
    matchingMode: byId.matchingMode,
    paymentStatus: recoveredPaymentStatus,
    checkoutStatus: status.status,
    checkoutExpiresAt: byId.expiresAt ?? order.checkoutExpiresAt ?? null,
    checkoutAsset: byId.checkoutAsset ?? order.checkoutAsset ?? null,
  });
  if (!updated) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  const safeOrder = publicOrder(updated);
  if (!safeOrder) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  return safeOrder;
};

export const updateOrder = (orderId: string, patch: Partial<Order>): Promise<Order | null> =>
  exampleRepository.mutateOrders(orders => {
    let updated: Order | null = null;
    const next = orders.map(order => {
      if (order.id !== orderId) return order;
      updated = { ...order, ...patch, updatedAt: new Date().toISOString() };
      return updated;
    });
    return [next, updated] as const;
  });

export const listCheckoutMethods = async (currency: string): Promise<CheckoutMethod[]> => {
  const methods = await findCheckoutMethods();
  return methods.filter(method => method.currencies.includes(currency)).map(normalizeCheckoutMethod);
};

export const startCheckoutOrder = async (input: StartCheckoutInput, payer: DemoPayer) => {
  const product = findProductById(input.productId);
  if (!product) return { status: 404, body: { error: 'No encontramos el producto seleccionado.' } } as const;
  const availableMethods = await listCheckoutMethods(product.currency);
  const selectedMethod = availableMethods.find(method => method.providerCode === input.providerCode);
  if (!selectedMethod) {
    return {
      status: 422,
      body: { error: 'El método de pago seleccionado no está disponible para esta moneda.' },
    } as const;
  }
  const selectedWallet = selectedMethod.acceptedWallets.find(wallet => wallet.id === input.acceptedWalletId);
  if (!selectedWallet)
    return { status: 422, body: { error: 'La billetera seleccionada no está disponible para este cobro.' } } as const;

  const externalId = buildExternalId();
  const capability = createOrderCapability();
  const createdAt = new Date().toISOString();
  const order: Order = {
    id: externalId,
    externalId,
    orderTokenHash: capability.tokenHash,
    product,
    paymentMode: 'checkout',
    providerCode: input.providerCode,
    providerDisplayName: selectedMethod.displayName,
    acceptedWalletId: input.acceptedWalletId,
    acceptedWallet: normalizeWallet(selectedWallet),
    paymentExpectation: null,
    matchingMode: 'expected_sender',
    paymentStatus: 'awaiting_payment',
    checkoutId: null,
    checkoutStatus: 'creating',
    checkoutExpiresAt: null,
    checkoutAsset: null,
    paymentEvent: null,
    createdAt,
    updatedAt: createdAt,
  };
  await addOrder(order);
  let checkout: CheckoutView;
  try {
    checkout = await createCheckout({
      externalId,
      providerCode: input.providerCode,
      acceptedWalletId: input.acceptedWalletId,
      amount: product.amount,
      currency: product.currency,
      matchingMode: 'expected_sender',
      payerDni: payer.dni,
      metadata: { productId: product.id, productName: product.name, integration: 'example-ecommerce' },
    });
  } catch (error) {
    await removeOrder(externalId);
    throw error;
  }
  const currentOrder = await findOrderById(externalId);
  const updatedOrder = await updateOrder(externalId, {
    acceptedWalletId: checkout.acceptedWalletId ?? checkout.acceptedWallet?.id ?? input.acceptedWalletId,
    acceptedWallet: normalizeWallet(checkout.acceptedWallet ?? selectedWallet),
    paymentExpectation: checkout.paymentExpectation ?? null,
    checkoutId: checkout.id,
    checkoutStatus:
      currentOrder?.paymentStatus === 'paid' ? (currentOrder.checkoutStatus ?? checkout.status) : checkout.status,
    checkoutExpiresAt: checkout.expiresAt ?? null,
    checkoutAsset: checkout.checkoutAsset ?? null,
  });
  return {
    status: 201,
    body: { order: publicOrder(updatedOrder), orderToken: capability.token, availableMethods },
  } as const;
};

export const retryCheckoutOrder = async (orderId: string, token: string) => {
  const order = await requireAuthorizedStoredOrder(orderId, token);
  if (!order.checkoutId) {
    return { status: 409, body: { error: 'Order has no standard checkout session' } } as const;
  }
  const externalId = buildExternalId();
  const capability = createOrderCapability();
  const retried = await retryCheckout(order.checkoutId, {
    externalId,
    metadata: {
      productId: order.product.id,
      productName: order.product.name,
      integration: 'example-ecommerce',
      retryOfOrderId: order.id,
    },
  });
  const checkout = retried.checkout;
  const createdAt = new Date().toISOString();
  const nextOrder: Order = {
    id: checkout.externalId,
    externalId: checkout.externalId,
    orderTokenHash: capability.tokenHash,
    product: order.product,
    paymentMode: 'checkout',
    providerCode: checkout.providerCode ?? order.providerCode,
    providerDisplayName: order.providerDisplayName,
    acceptedWalletId: checkout.acceptedWalletId ?? checkout.acceptedWallet?.id ?? order.acceptedWalletId ?? null,
    acceptedWallet: normalizeWallet(checkout.acceptedWallet ?? order.acceptedWallet),
    paymentExpectation: checkout.paymentExpectation ?? order.paymentExpectation ?? null,
    matchingMode: checkout.matchingMode ?? order.matchingMode,
    paymentStatus: 'awaiting_payment',
    checkoutId: checkout.id,
    checkoutStatus: checkout.status,
    checkoutExpiresAt: checkout.expiresAt ?? null,
    checkoutAsset: checkout.checkoutAsset ?? order.checkoutAsset ?? null,
    paymentEvent: null,
    retryOfOrderId: order.id,
    retryOfExternalId: order.externalId,
    createdAt,
    updatedAt: createdAt,
  };
  await addOrder(nextOrder);
  return {
    status: 201,
    body: { order: publicOrder(nextOrder), orderToken: capability.token, previousOrderId: order.id },
  } as const;
};

export const cancelCheckoutOrder = async (orderId: string, token: string) => {
  const order = await requireAuthorizedStoredOrder(orderId, token);
  if (!order.checkoutId) {
    return { status: 409, body: { error: 'Order has no standard checkout session' } } as const;
  }
  if (order.paymentStatus !== 'awaiting_payment') {
    return { status: 200, body: { order: publicOrder(order), checkout: null, changed: false } } as const;
  }
  const result = await cancelCheckout(order.checkoutId);
  const checkout = result.checkout;
  const updated = await updateOrder(order.id, {
    paymentStatus: 'canceled',
    checkoutStatus: checkout?.status ?? 'canceled',
    acceptedWalletId: checkout?.acceptedWalletId ?? checkout?.acceptedWallet?.id ?? order.acceptedWalletId ?? null,
    acceptedWallet: normalizeWallet(checkout?.acceptedWallet ?? order.acceptedWallet),
    paymentExpectation: checkout?.paymentExpectation ?? order.paymentExpectation ?? null,
    checkoutAsset: checkout?.checkoutAsset ?? order.checkoutAsset ?? null,
  });
  return {
    status: 200,
    body: { order: publicOrder(updated), checkout: checkout ?? null, changed: result.changed ?? true },
  } as const;
};

const withDelivery = (receipt: WebhookReceipt, deliveryId: string): WebhookReceipt => ({
  ...receipt,
  deliveryIds: receipt.deliveryIds.includes(deliveryId) ? receipt.deliveryIds : [...receipt.deliveryIds, deliveryId],
  updatedAt: new Date().toISOString(),
});

const persistReceipt = (input: {
  readonly eventId: string;
  readonly deliveryId: string;
  readonly type: string;
  readonly status: WebhookReceiptStatus;
  readonly updated: boolean;
}): Promise<void> =>
  exampleRepository.mutateWebhookReceipts(receipts => {
    const now = new Date().toISOString();
    const existing = receipts.find(receipt => receipt.eventId === input.eventId);
    const next: WebhookReceipt = existing
      ? { ...withDelivery(existing, input.deliveryId), status: input.status, updated: input.updated }
      : {
          eventId: input.eventId,
          deliveryIds: [input.deliveryId],
          type: input.type,
          receivedAt: now,
          updatedAt: now,
          status: input.status,
          updated: input.updated,
        };
    return [[next, ...receipts.filter(receipt => receipt.eventId !== input.eventId)], undefined] as const;
  });

const assertWebhookEnvironment = (payload: { readonly environment: string; readonly livemode: boolean }): void => {
  if (
    payload.environment !== env.ALTOKEPAY_ENVIRONMENT ||
    payload.livemode !== (payload.environment === 'production')
  ) {
    throw new HttpError(400, 'WEBHOOK_ENVIRONMENT_MISMATCH', 'Webhook environment does not match this integration');
  }
};

const assertWebhookMatchesOrder = (payload: CheckoutWebhookPayload, order: Order): void => {
  const checkout = payload.data.checkout;
  assertWebhookEnvironment(payload);
  if (
    checkout.externalId !== order.externalId ||
    checkout.id !== order.checkoutId ||
    checkout.amount !== order.product.amount ||
    checkout.currency !== order.product.currency ||
    checkout.providerCode !== order.providerCode ||
    checkout.status !== expectedStatuses[payload.type]
  ) {
    throw new HttpError(400, 'WEBHOOK_ORDER_MISMATCH', 'Webhook snapshot does not match the local order');
  }
  if (payload.type === 'checkout.paid') {
    const payment = payload.data.payment;
    if (
      !payment ||
      payment.amount !== order.product.amount ||
      payment.currency !== order.product.currency ||
      payment.providerCode !== order.providerCode ||
      payment.status !== 'processed'
    ) {
      throw new HttpError(400, 'WEBHOOK_PAYMENT_MISMATCH', 'Webhook payment does not match the local order');
    }
  }
  if (payload.type === 'checkout.retry_created') {
    const retry = payload.data.retry;
    if (order.retryOfExternalId !== retry.retryOfExternalId) {
      throw new HttpError(400, 'WEBHOOK_ORDER_MISMATCH', 'Webhook retry lineage does not match the local order');
    }
  }
};

const applyWebhook = async (payload: CheckoutWebhookPayload): Promise<Order | null> => {
  const order = await findOrderById(payload.data.checkout.externalId);
  if (!order?.checkoutId) return null;
  assertWebhookMatchesOrder(payload, order);
  if (payload.type === 'checkout.retry_created') {
    const previousOrder = await findOrderById(payload.data.retry.retryOfExternalId);
    if (!previousOrder) return null;
    if (
      order.retryOfOrderId !== previousOrder.id ||
      previousOrder.checkoutId !== payload.data.retry.retryOfCheckoutId
    ) {
      throw new HttpError(400, 'WEBHOOK_ORDER_MISMATCH', 'Webhook retry lineage does not match the previous order');
    }
  }
  const checkout = payload.data.checkout;
  const context: Partial<Order> = {
    acceptedWalletId: checkout.acceptedWalletId ?? order.acceptedWalletId ?? null,
    acceptedWallet: normalizeWallet(checkout.acceptedWallet ?? order.acceptedWallet),
    paymentExpectation: checkout.paymentExpectation ?? order.paymentExpectation ?? null,
    checkoutAsset: checkout.checkoutAsset ?? order.checkoutAsset ?? null,
    checkoutStatus: checkout.status,
    checkoutExpiresAt: checkout.expiresAt ?? order.checkoutExpiresAt ?? null,
    webhookEventType: payload.type,
  };
  if (payload.type === 'checkout.paid') {
    return updateOrder(order.id, {
      ...context,
      paymentStatus: 'paid',
      paymentEvent: payload.data.payment,
    });
  }
  if (payload.type === 'checkout.expired') return updateOrder(order.id, { ...context, paymentStatus: 'expired' });
  if (payload.type === 'checkout.canceled') return updateOrder(order.id, { ...context, paymentStatus: 'canceled' });
  return updateOrder(order.id, context);
};

let webhookQueue: Promise<void> = Promise.resolve();

export const processCheckoutWebhook = (
  eventId: string,
  deliveryId: string,
  envelope: v.InferOutput<typeof webhookEnvelopeSchema>,
): Promise<{
  readonly duplicate: boolean;
  readonly updated: boolean;
  readonly retryable: boolean;
  readonly order: Order | null;
}> => {
  let resolveResult: (value: {
    duplicate: boolean;
    updated: boolean;
    retryable: boolean;
    order: Order | null;
  }) => void = () => undefined;
  let rejectResult: (reason?: unknown) => void = () => undefined;
  const result = new Promise<{ duplicate: boolean; updated: boolean; retryable: boolean; order: Order | null }>(
    (resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    },
  );
  const operation = webhookQueue.then(async () => {
    try {
      const existing = (await exampleRepository.readWebhookReceipts()).find(receipt => receipt.eventId === eventId);
      if (existing && terminalReceiptStatuses.has(existing.status)) {
        await persistReceipt({
          eventId,
          deliveryId,
          type: existing.type,
          status: existing.status,
          updated: existing.updated,
        });
        resolveResult({ duplicate: true, updated: existing.updated, retryable: false, order: null });
        return;
      }
      if (!supportedWebhookTypes.has(envelope.type)) {
        await persistReceipt({
          eventId,
          deliveryId,
          type: envelope.type,
          status: 'ignored_unsupported',
          updated: false,
        });
        resolveResult({ duplicate: false, updated: false, retryable: false, order: null });
        return;
      }
      if (envelope.type === 'webhook.ping' || envelope.type === 'payment.received') {
        const schema = envelope.type === 'webhook.ping' ? webhookPingSchema : paymentReceivedWebhookSchema;
        const parsedNoOp = v.safeParse(schema, envelope);
        if (!parsedNoOp.success) throw new HttpError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Invalid webhook payload');
        assertWebhookEnvironment(parsedNoOp.output);
        await persistReceipt({ eventId, deliveryId, type: envelope.type, status: 'processed', updated: false });
        resolveResult({ duplicate: false, updated: false, retryable: false, order: null });
        return;
      }
      const parsed = v.safeParse(checkoutWebhookSchema, envelope);
      if (!parsed.success) throw new HttpError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Invalid webhook payload');
      const order = await applyWebhook(parsed.output);
      if (!order) {
        await persistReceipt({
          eventId,
          deliveryId,
          type: envelope.type,
          status: 'retryable_missing_order',
          updated: false,
        });
        resolveResult({ duplicate: false, updated: false, retryable: true, order: null });
        return;
      }
      await persistReceipt({ eventId, deliveryId, type: envelope.type, status: 'processed', updated: true });
      resolveResult({ duplicate: false, updated: true, retryable: false, order });
    } catch (error) {
      await persistReceipt({
        eventId,
        deliveryId,
        type: envelope.type,
        status: 'retryable_failed',
        updated: false,
      }).catch(() => undefined);
      rejectResult(error);
    }
  });
  webhookQueue = operation.catch(() => undefined);
  return result;
};
