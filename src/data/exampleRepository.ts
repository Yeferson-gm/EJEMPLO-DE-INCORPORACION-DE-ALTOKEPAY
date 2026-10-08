import { paths } from '#config/paths';
import type { PayerSession } from '#domain/payer';
import type { PaymentLinkIntent, PaymentLinkRecord } from '#domain/paymentLink';
import type { OAuthTokens, Order, WebhookReceipt } from '#domain/types';
import { mutateJsonFile, readJsonFile, writeJsonFile } from '#lib/jsonFile';

export const exampleRepository = {
  readPayerSessions: (): Promise<PayerSession[]> => readJsonFile<PayerSession[]>(paths.payerSessionsFilePath, []),
  mutatePayerSessions: <Result>(
    mutation: (
      sessions: PayerSession[],
    ) => Promise<readonly [PayerSession[], Result]> | readonly [PayerSession[], Result],
  ) => mutateJsonFile(paths.payerSessionsFilePath, [] as PayerSession[], mutation),
  readPaymentLinks: (): Promise<PaymentLinkRecord[]> =>
    readJsonFile<PaymentLinkRecord[]>(paths.paymentLinksFilePath, []),
  mutatePaymentLinks: <Result>(
    mutation: (
      paymentLinks: PaymentLinkRecord[],
    ) => Promise<readonly [PaymentLinkRecord[], Result]> | readonly [PaymentLinkRecord[], Result],
  ) => mutateJsonFile(paths.paymentLinksFilePath, [] as PaymentLinkRecord[], mutation),
  readPaymentLinkIntents: (): Promise<PaymentLinkIntent[]> =>
    readJsonFile<PaymentLinkIntent[]>(paths.paymentLinkIntentsFilePath, []),
  mutatePaymentLinkIntents: <Result>(
    mutation: (
      intents: PaymentLinkIntent[],
    ) => Promise<readonly [PaymentLinkIntent[], Result]> | readonly [PaymentLinkIntent[], Result],
  ) => mutateJsonFile(paths.paymentLinkIntentsFilePath, [] as PaymentLinkIntent[], mutation),
  readOrders: (): Promise<Order[]> => readJsonFile<Order[]>(paths.ordersFilePath, []),
  mutateOrders: <Result>(mutation: (orders: Order[]) => Promise<readonly [Order[], Result]> | readonly [Order[], Result]) =>
    mutateJsonFile(paths.ordersFilePath, [] as Order[], mutation),
  readTokens: (): Promise<OAuthTokens> => readJsonFile<OAuthTokens>(paths.tokensFilePath, {}),
  writeTokens: (tokens: OAuthTokens): Promise<void> => writeJsonFile(paths.tokensFilePath, tokens),
  mutateTokens: <Result>(
    mutation: (tokens: OAuthTokens) => Promise<readonly [OAuthTokens, Result]> | readonly [OAuthTokens, Result],
  ) => mutateJsonFile(paths.tokensFilePath, {} as OAuthTokens, mutation),
  readWebhookReceipts: (): Promise<WebhookReceipt[]> =>
    readJsonFile<WebhookReceipt[]>(paths.webhookReceiptsFilePath, []),
  mutateWebhookReceipts: <Result>(
    mutation: (
      receipts: WebhookReceipt[],
    ) => Promise<readonly [WebhookReceipt[], Result]> | readonly [WebhookReceipt[], Result],
  ) => mutateJsonFile(paths.webhookReceiptsFilePath, [] as WebhookReceipt[], mutation),
};
