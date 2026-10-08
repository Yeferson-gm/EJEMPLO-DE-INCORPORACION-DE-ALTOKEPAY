import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { env, hasValidMerchantCredentials } from '#config/env';

const basicChallenge = 'Basic realm="AltokePay Merchant", charset="UTF-8"';
const basicTokenPattern = /^Basic ([A-Za-z0-9+/]+={0,2})$/i;
const maximumAuthorizationLength = 1024;

const digest = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

const decodeBasicCredentials = (authorization: string | undefined): readonly [string, string] | null => {
  if (!authorization || authorization.length > maximumAuthorizationLength) return null;
  const match = basicTokenPattern.exec(authorization);
  const token = match?.[1];
  if (!token || token.length % 4 !== 0) return null;

  let decoded: string;
  try {
    const bytes = Buffer.from(token, 'base64');
    if (bytes.toString('base64') !== token) return null;
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  const separator = decoded.indexOf(':');
  if (separator <= 0) return null;
  return [decoded.slice(0, separator), decoded.slice(separator + 1)];
};

const credentialsMatch = (authorization: string | undefined): boolean => {
  if (!hasValidMerchantCredentials(env)) return false;
  const credentials = decodeBasicCredentials(authorization);
  const suppliedUsername = credentials?.[0] ?? '';
  const suppliedPassword = credentials?.[1] ?? '';
  const usernameMatches = timingSafeEqual(digest(suppliedUsername), digest(env.EXAMPLE_MERCHANT_USERNAME));
  const passwordMatches = timingSafeEqual(digest(suppliedPassword), digest(env.EXAMPLE_MERCHANT_PASSWORD));
  return credentials !== null && usernameMatches && passwordMatches;
};

const decodePathname = (pathname: string): string => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
};

const isProtectedMerchantRequest = (pathname: string, method: string): boolean => {
  const decodedPathname = decodePathname(pathname);
  return (
    ((method === 'GET' || method === 'HEAD') && decodedPathname === '/payment-links.html') ||
    decodedPathname === '/api/payment-links' ||
    decodedPathname.startsWith('/api/payment-links/')
  );
};

export const merchantBasicAuth: MiddlewareHandler = async (context, next) => {
  if (!isProtectedMerchantRequest(context.req.path, context.req.method)) {
    await next();
    return;
  }
  if (credentialsMatch(context.req.header('authorization'))) {
    await next();
    return;
  }

  context.header('WWW-Authenticate', basicChallenge);
  context.header('Cache-Control', 'no-store');
  context.header('Pragma', 'no-cache');
  const headers = { 'Content-Type': 'text/plain; charset=UTF-8' };
  if (context.req.method === 'HEAD') return context.body(null, 401, headers);
  return context.body('Unauthorized', 401, headers);
};
