export const checkoutExpirationWindowMs = 5 * 60 * 1000;
export const maximumJsonBodyBytes = 1024 * 1024;
export const upstreamTimeoutMs = 10_000;
export const requiredClientScopes = [
  'payment-methods:read',
  'checkouts:read',
  'checkouts:write',
  'payment-links:read',
  'payment-links:write',
] as const;
