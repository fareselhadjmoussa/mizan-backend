/**
 * 🔁 SERIALIZATION HELPERS
 * ════════════════════════════════════════════════════════════════════════════
 * Prisma maps PostgreSQL `Decimal` columns (price, totals, etc.) to its own
 * `Decimal` runtime type — not a plain JS `number`. The frontend has always
 * worked with plain numbers, so every value that came out of a Decimal
 * column is normalized here before it's sent in an API response.
 */

import type { Product, Sale, SaleItem, User } from '../generated/prisma';

// Converts a Prisma Decimal (or null) to a plain number (or undefined)
const num = (value: unknown): number =>
  value === null || value === undefined ? 0 : Number(value);

const numOrUndefined = (value: unknown): number | undefined =>
  value === null || value === undefined ? undefined : Number(value);

export const serializeProduct = (p: Product) => ({
  ...p,
  price: num(p.price),
  barcode: p.barcode ?? undefined,
  image: p.image ?? undefined,
});

export const serializeSaleItem = (
  i: SaleItem & { product?: Product | null }
) => ({
  ...i,
  unitPrice: num(i.unitPrice),
  discount: num(i.discount),
  product: i.product ? serializeProduct(i.product) : null,
});

export const serializeSale = (
  s: Sale & {
    items?: (SaleItem & { product?: Product | null })[];
    user?: User | null;
  }
) => ({
  ...s,
  subtotal: num(s.subtotal),
  tax: num(s.tax),
  discount: num(s.discount),
  total: num(s.total),
  cashPaid: numOrUndefined(s.cashPaid),
  cardPaid: numOrUndefined(s.cardPaid),
  note: s.note ?? undefined,
  items: s.items?.map(serializeSaleItem) ?? [],
  user: s.user ? { name: s.user.name } : undefined,
});

export const toPublicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  isActive: u.isActive,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
});
