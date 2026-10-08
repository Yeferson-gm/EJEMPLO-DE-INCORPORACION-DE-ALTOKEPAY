import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { exampleRepository } from '#data/exampleRepository';
import type { DemoPayer, PayerInput, PayerSession } from '#domain/payer';
import { HttpError } from '#lib/httpError';

export const payerSessionCookieName = 'altokepay_example_payer';
export const payerSessionMaxAgeSeconds = 8 * 60 * 60;

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

const readTokenHash = (token: string | undefined): string | undefined =>
  token && tokenPattern.test(token) ? hashToken(token) : undefined;

export const createPayerSession = async (
  input: PayerInput,
  previousToken?: string,
): Promise<{ readonly token: string; readonly payer: DemoPayer }> => {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const previousTokenHash = readTokenHash(previousToken);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + payerSessionMaxAgeSeconds * 1000).toISOString();
  const payer: DemoPayer = { id: randomUUID(), dni: input.dni, createdAt };
  const session: PayerSession = { tokenHash, payer, expiresAt };

  await exampleRepository.mutatePayerSessions(sessions => {
    const now = Date.now();
    const active = sessions.filter(candidate => {
      if (candidate.tokenHash === previousTokenHash) return false;
      const expiration = Date.parse(candidate.expiresAt);
      return Number.isFinite(expiration) && expiration > now;
    });
    return [[...active, session], undefined] as const;
  });

  return { token, payer };
};

export const findPayerBySessionToken = async (token: string | undefined): Promise<DemoPayer | null> => {
  const tokenHash = readTokenHash(token);
  if (!tokenHash) return null;
  const sessions = await exampleRepository.readPayerSessions();
  const session = sessions.find(candidate => candidate.tokenHash === tokenHash);
  if (!session) return null;
  const expiration = Date.parse(session.expiresAt);
  return Number.isFinite(expiration) && expiration > Date.now() ? session.payer : null;
};

export const requirePayerBySessionToken = async (token: string | undefined): Promise<DemoPayer> => {
  const payer = await findPayerBySessionToken(token);
  if (!payer) {
    throw new HttpError(401, 'PAYER_SESSION_REQUIRED', 'Ingresa el DNI del pagador antes de iniciar la prueba.');
  }
  return payer;
};
