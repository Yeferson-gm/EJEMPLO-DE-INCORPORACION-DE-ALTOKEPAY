import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const paths = {
  rootDir,
  dataDir: path.join(rootDir, 'data'),
  publicDir: path.join(rootDir, 'public'),
  ordersFilePath: path.join(rootDir, 'data', 'orders.json'),
  tokensFilePath: path.join(rootDir, 'data', 'tokens.json'),
  webhookReceiptsFilePath: path.join(rootDir, 'data', 'webhookReceipts.json'),
  payerSessionsFilePath: path.join(rootDir, 'data', 'payerSessions.json'),
  paymentLinksFilePath: path.join(rootDir, 'data', 'paymentLinks.json'),
  paymentLinkIntentsFilePath: path.join(rootDir, 'data', 'paymentLinkIntents.json'),
} as const;
