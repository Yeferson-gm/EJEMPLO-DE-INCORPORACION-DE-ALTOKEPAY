import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const hashToken = (token: string): Buffer => createHash('sha256').update(token, 'utf8').digest();

export const buildExternalId = (): string => randomUUID();
export const fingerprintJson = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

export const createOrderCapability = (): { readonly token: string; readonly tokenHash: string } => {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token).toString('hex') };
};

export const verifyOrderCapability = (token: string, tokenHash: string): boolean => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[a-f0-9]{64}$/.test(tokenHash)) return false;
  return timingSafeEqual(hashToken(token), Buffer.from(tokenHash, 'hex'));
};
