import * as v from 'valibot';
import { requiredClientScopes, upstreamTimeoutMs } from '#config/constants';
import { env } from '#config/env';
import { exampleRepository } from '#data/exampleRepository';
import type { Environment, OAuthTokens } from '#domain/types';
import { HttpError } from '#lib/httpError';

const requiredText = v.pipe(v.string(), v.minLength(1));
const tokenSchema = v.object({
  accessToken: requiredText,
  refreshToken: v.optional(requiredText),
  accessTokenExpiresAt: requiredText,
  refreshTokenExpiresAt: v.optional(requiredText),
});
const identitySchema = v.object({
  scopes: v.array(v.string()),
  environment: v.picklist(['production', 'sandbox']),
});
const upstreamErrorSchema = v.object({ code: v.string() });
const safeUpstreamErrors = {
  BILLING_PAYMENT_REQUIRED: {
    status: 402,
    message: 'AltokePay requiere regularizar la cuenta comercial antes de crear nuevos cobros.',
  },
  IDENTITY_SERVICE_UNAVAILABLE: {
    status: 503,
    message: 'No pudimos validar el DNI en este momento. Inténtalo nuevamente en unos minutos.',
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    message: 'La misma referencia comercial ya fue usada con datos diferentes.',
  },
  CONFLICT: { status: 409, message: 'La operación entra en conflicto con el estado actual del recurso.' },
  UNPROCESSABLE_ENTITY: { status: 422, message: 'AltokePay rechazó la operación por una regla comercial.' },
  NOT_FOUND: { status: 404, message: 'AltokePay no encontró el recurso solicitado.' },
  TOO_MANY_REQUESTS: { status: 429, message: 'AltokePay limitó temporalmente las solicitudes. Inténtalo nuevamente.' },
} as const;
const apiResponseSchema = <TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(schema: TSchema) =>
  v.object({ success: v.literal(true), data: schema });

const storeTokens = (tokens: OAuthTokens): Promise<void> =>
  exampleRepository.mutateTokens(() => [tokens, undefined] as const);

const integrationError = (): HttpError =>
  new HttpError(502, 'ALTOKEPAY_UNAVAILABLE', 'AltokePay no está disponible temporalmente. Inténtalo nuevamente.');

const integrationErrorFromResponse = async (response: Response): Promise<HttpError> => {
  const payload = await response.json().catch(() => undefined);
  const parsed = v.safeParse(upstreamErrorSchema, payload);
  if (!parsed.success || !Object.hasOwn(safeUpstreamErrors, parsed.output.code)) return integrationError();
  const code = parsed.output.code as keyof typeof safeUpstreamErrors;
  const safe = safeUpstreamErrors[code];
  return new HttpError(safe.status, code, safe.message);
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw integrationError();
  }
};

const fetchWithTimeout = (url: string, init: RequestInit): Promise<Response> => {
  const timeoutSignal = AbortSignal.timeout(upstreamTimeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, { ...init, signal }).catch(() => {
    throw integrationError();
  });
};

const parseTokenResponse = async (response: Response): Promise<OAuthTokens & { readonly accessToken: string }> => {
  if (!response.ok) throw integrationError();
  const result = v.safeParse(apiResponseSchema(tokenSchema), await readJson(response));
  if (!result.success) throw integrationError();
  return result.output.data;
};

const requestToken = async (body: unknown): Promise<OAuthTokens & { readonly accessToken: string }> =>
  parseTokenResponse(
    await fetchWithTimeout(`${env.ALTOKEPAY_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const performAuthorizedRequest = (pathname: string, init: RequestInit, accessToken: string): Promise<Response> => {
  const suppliedHeaders = new Headers(init.headers);
  if (suppliedHeaders.has('authorization')) {
    throw new HttpError(500, 'UNSAFE_AUTHORIZATION_OVERRIDE', 'Authorization header override is not allowed');
  }
  suppliedHeaders.set('Accept', 'application/json');
  suppliedHeaders.set('Authorization', `Bearer ${accessToken}`);
  if (init.body !== undefined && !suppliedHeaders.has('content-type'))
    suppliedHeaders.set('Content-Type', 'application/json');
  return fetchWithTimeout(`${env.ALTOKEPAY_BASE_URL}${pathname}`, { ...init, headers: suppliedHeaders });
};

const assertIdentity = (input: unknown): void => {
  const parsed = v.safeParse(identitySchema, input);
  if (!parsed.success) throw integrationError();
  const expectedEnvironment: Environment | undefined = env.ALTOKEPAY_ENVIRONMENT;
  const missingScopes = requiredClientScopes.filter(scope => !parsed.output.scopes.includes(scope));
  if (parsed.output.environment !== expectedEnvironment || missingScopes.length > 0) {
    throw new HttpError(500, 'ALTOKEPAY_CONFIGURATION_MISMATCH', 'AltokePay scopes or environment do not match');
  }
};

const validateIdentity = async (accessToken: string): Promise<void> => {
  const response = await performAuthorizedRequest('/api/v1/client/auth/me', {}, accessToken);
  if (!response.ok) throw integrationError();
  const parsed = v.safeParse(apiResponseSchema(identitySchema), await readJson(response));
  if (!parsed.success) throw integrationError();
  assertIdentity(parsed.output.data);
};

const exchangeApiKey = async (): Promise<OAuthTokens & { readonly accessToken: string }> => {
  if (!env.ALTOKEPAY_API_KEY.trim()) {
    throw new HttpError(500, 'ALTOKEPAY_NOT_CONFIGURED', 'AltokePay is not configured');
  }
  const tokens = await requestToken({ grantType: 'apiKey', apiKey: env.ALTOKEPAY_API_KEY });
  await validateIdentity(tokens.accessToken);
  await storeTokens(tokens);
  return tokens;
};

let refreshInFlight: Promise<OAuthTokens & { readonly accessToken: string }> | undefined;

const refreshAccessSession = (refreshToken: string): Promise<OAuthTokens & { readonly accessToken: string }> => {
  if (refreshInFlight) return refreshInFlight;
  const operation = (async () => {
    const tokens = await requestToken({ grantType: 'refreshToken', refreshToken });
    await validateIdentity(tokens.accessToken);
    await storeTokens(tokens);
    return tokens;
  })();
  refreshInFlight = operation;
  void operation.finally(() => {
    if (refreshInFlight === operation) refreshInFlight = undefined;
  });
  return operation;
};

const clearStoredTokens = (): Promise<void> => storeTokens({});

const ensureAccessToken = async (): Promise<string> => {
  const tokens = await exampleRepository.readTokens();
  const expiresAt = tokens.accessTokenExpiresAt ? Date.parse(tokens.accessTokenExpiresAt) : 0;
  if (tokens.accessToken && Number.isFinite(expiresAt) && expiresAt - Date.now() > 60_000) return tokens.accessToken;
  if (tokens.refreshToken) {
    try {
      return (await refreshAccessSession(tokens.refreshToken)).accessToken;
    } catch {
      await clearStoredTokens();
    }
  }
  return (await exchangeApiKey()).accessToken;
};

export const requestAltokePay = async <T>(pathname: string, init: RequestInit = {}): Promise<T> => {
  if (new Headers(init.headers).has('authorization')) {
    throw new HttpError(500, 'UNSAFE_AUTHORIZATION_OVERRIDE', 'Authorization header override is not allowed');
  }
  let accessToken = await ensureAccessToken();
  let response = await performAuthorizedRequest(pathname, init, accessToken);
  if (response.status === 401) {
    const tokens = await exampleRepository.readTokens();
    try {
      accessToken = tokens.refreshToken
        ? (await refreshAccessSession(tokens.refreshToken)).accessToken
        : (await exchangeApiKey()).accessToken;
    } catch {
      await clearStoredTokens();
      accessToken = (await exchangeApiKey()).accessToken;
    }
    response = await performAuthorizedRequest(pathname, init, accessToken);
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok) throw await integrationErrorFromResponse(response);
  const payload = await readJson(response);
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('success' in payload) ||
    payload.success !== true ||
    !('data' in payload)
  ) {
    throw integrationError();
  }
  return payload.data as T;
};

export const validateAltokePayClient = async (): Promise<void> =>
  assertIdentity(await requestAltokePay<unknown>('/api/v1/client/auth/me'));

export const logoutAltokePayClient = async (): Promise<void> => {
  const tokens = await exampleRepository.readTokens();
  try {
    if (tokens.accessToken) {
      const response = await performAuthorizedRequest(
        '/api/v1/client/auth/logout',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
        },
        tokens.accessToken,
      );
      if (!response.ok && response.status !== 401) throw integrationError();
    }
  } finally {
    await clearStoredTokens();
  }
};
