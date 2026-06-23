import type { Product, Sale, SaleItem, User } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

// Converts Prisma Decimal (or null) to number
const num = (value: unknown): number => {
  if (value instanceof Decimal) return value.toNumber();
  if (value === null || value === undefined) return 0;
  return Number(value);
};

const numOrUndefined = (value: unknown): number | undefined => {
  if (value instanceof Decimal) return value.toNumber();
  if (value === null || value === undefined) return undefined;
  return Number(value);
};

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