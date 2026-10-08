import * as v from 'valibot';

import productsConfig from '#configData/products' with { type: 'json' };

const requiredTextSchema = v.pipe(v.string(), v.trim(), v.minLength(1));
const hasAtMostTwoDecimalPlaces = (value: number): boolean => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;

const productSchema = v.strictObject({
  id: v.pipe(requiredTextSchema, v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  name: requiredTextSchema,
  description: requiredTextSchema,
  amount: v.pipe(
    v.number(),
    v.minValue(0.01),
    v.check(hasAtMostTwoDecimalPlaces, 'El monto admite como máximo dos decimales'),
  ),
  currency: v.pipe(v.string(), v.regex(/^[A-Z]{3}$/)),
  imageLabel: requiredTextSchema,
  imageUrl: v.pipe(v.string(), v.regex(/^\/images\/[a-z0-9-]+\.svg$/)),
});

const productsConfigSchema = v.strictObject({
  version: v.literal(1),
  products: v.pipe(
    v.array(productSchema),
    v.minLength(1),
    v.check(items => new Set(items.map(item => item.id)).size === items.length, 'Los IDs de producto deben ser únicos'),
  ),
});

export const products = v.parse(productsConfigSchema, productsConfig).products;

const productIds = products.map(product => product.id) as [string, ...string[]];
export const startCheckoutSchema = v.strictObject({
  productId: v.picklist(productIds),
  providerCode: v.pipe(v.string(), v.trim(), v.minLength(1)),
  acceptedWalletId: v.pipe(v.string(), v.trim(), v.minLength(1)),
});
export type StartCheckoutInput = v.InferOutput<typeof startCheckoutSchema>;
export const findProductById = (productId: string) => products.find(product => product.id === productId);
