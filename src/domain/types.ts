export type Environment = 'production' | 'sandbox';
export type PaymentStatus = 'awaiting_payment' | 'paid' | 'expired' | 'canceled';

export type Product = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly amount: number;
  readonly currency: string;
  readonly imageLabel: string;
  readonly imageUrl: string;
};

export type Wallet = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly iconUrl?: string | undefined;
  readonly icon?: { readonly secureUrl?: string | undefined } | undefined;
};

export type CheckoutMethod = {
  readonly providerCode: string;
  readonly displayName: string;
  readonly currencies: readonly string[];
  readonly iconUrl?: string | undefined;
  readonly acceptedWallets: readonly Wallet[];
};

export type PaymentExpectation = { readonly message: string };
export type CheckoutAsset = { readonly secureUrl?: string | undefined };
export type PaymentEvent = {
  readonly id: string;
  readonly providerCode: string;
  readonly amount: number;
  readonly currency: string;
  readonly status: string;
  readonly occurredAt?: string | undefined;
  readonly createdAt?: string | undefined;
  readonly senderName?: string | undefined;
};

export type Order = {
  readonly id: string;
  readonly externalId: string;
  readonly orderTokenHash?: string | undefined;
  readonly product: Product;
  readonly paymentMode: 'checkout';
  readonly paymentStatus: PaymentStatus;
  readonly providerCode?: string | undefined;
  readonly providerDisplayName?: string | undefined;
  readonly acceptedWalletId?: string | null;
  readonly acceptedWallet?: Wallet | null;
  readonly paymentExpectation?: PaymentExpectation | null;
  readonly matchingMode?: string | undefined;
  readonly checkoutId?: string | null;
  readonly checkoutStatus?: string | null;
  readonly checkoutExpiresAt?: string | null;
  readonly checkoutAsset?: CheckoutAsset | null;
  readonly paymentEvent?: PaymentEvent | null;

  readonly retryOfOrderId?: string | undefined;
  readonly retryOfExternalId?: string | undefined;
  readonly webhookEventType?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type WebhookReceiptStatus = 'processed' | 'ignored_unsupported' | 'retryable_missing_order' | 'retryable_failed';
export type WebhookReceipt = {
  readonly eventId: string;
  readonly deliveryIds: readonly string[];
  readonly type: string;
  readonly receivedAt: string;
  readonly updatedAt: string;
  readonly status: WebhookReceiptStatus;
  readonly updated: boolean;
};

export type OAuthTokens = {
  readonly accessToken?: string | undefined;
  readonly refreshToken?: string | undefined;
  readonly accessTokenExpiresAt?: string | undefined;
  readonly refreshTokenExpiresAt?: string | undefined;
};
