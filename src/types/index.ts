/**
 * 📐 TYPE DEFINITIONS
 * ════════════════════════════════════════════════════════════════════════════
 *
 * These are the plain TS shapes used across controllers/routes — independent
 * from the Prisma-generated types (src/generated/prisma) so the API layer
 * doesn't leak Decimal/Date runtime types straight to the frontend.
 * See src/utils/serialize.ts for the Prisma → these-types conversion.
 *
 * Key design decisions documented here:
 *
 * 1. All interfaces are CLOSED — no [key: string]: unknown index signature.
 *    This preserves strong typing: user.email is `string`, not `unknown`.
 *
 * 2. AuthRequest properly extends Request<Params, ResBody, Body, Query>
 *    with typed generics — this fixes "Property 'body' does not exist"
 *    and "Property 'params' does not exist" errors across all controllers.
 *
 * 3. PublicUser = Omit<User, 'passwordHash'> — safe type-level omission,
 *    no runtime spreading required.
 */

import { Request } from 'express';
import { ParamsDictionary } from 'express-serve-static-core';
import { ParsedQs } from 'qs';

// ── Enums (plain string unions — no Prisma dependency) ───────────────────────
export type Role    = 'ADMIN' | 'CASHIER';
export type PayType = 'CASH'  | 'CARD'    | 'MIXED';
export type LogType = 'SALE'  | 'RESTOCK' | 'ADJUSTMENT';

// ── Base entity ───────────────────────────────────────────────────────────────
// All stored records have at minimum `id` and `createdAt`.
// Extending this satisfies the `StoredEntity` constraint in db.ts.
interface BaseEntity {
  id:        string;
  createdAt: string;
}

// ── Domain Models ─────────────────────────────────────────────────────────────

export interface User extends BaseEntity {
  name:         string;
  email:        string;
  passwordHash: string;
  role:         Role;
  isActive:     boolean;
  updatedAt:    string;
}

export interface Product extends BaseEntity {
  name:       string;
  price:      number;
  stock:      number;
  lowStock:   number;
  barcode?:   string;
  image?:     string;
  isActive:   boolean;
  updatedAt:  string;
}

export interface SaleItem extends BaseEntity {
  saleId:    string;
  productId: string;
  qty:       number;
  unitPrice: number;
  discount:  number;
}

export interface Sale extends BaseEntity {
  invoiceNo:   string;
  subtotal:    number;
  tax:         number;
  discount:    number;
  total:       number;
  paymentType: PayType;
  cashPaid?:   number;
  cardPaid?:   number;
  note?:       string;
  userId:      string;
  items:       SaleItem[];
}

export interface StockLog extends BaseEntity {
  productId: string;
  delta:     number;
  type:      LogType;
  note?:     string;
}

// ── API Helpers ───────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  email:  string;
  role:   Role;
}

/**
 * AuthRequest properly extends Express's Request with all four generics.
 *
 * WHY THIS MATTERS:
 * If you just write `interface AuthRequest extends Request { user?: JwtPayload }`
 * TypeScript sometimes loses `params`, `body`, and `query` in strict mode
 * because it can't infer the generic slots.
 *
 * The fix: explicitly carry all four generics through so controllers
 * that use `req.params`, `req.body`, `req.query` compile cleanly.
 */
export interface AuthRequest<
  P = ParamsDictionary,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = ParsedQs,
> extends Request<P, ResBody, ReqBody, ReqQuery> {
  user?: JwtPayload;
}

export interface ApiResponse<T = unknown> {
  success:  boolean;
  data?:    T;
  message?: string;
  error?:   string;
}

// ── Derived / utility types ───────────────────────────────────────────────────

/** Safe user shape to send to clients — passwordHash is stripped at type level */
export type PublicUser = Omit<User, 'passwordHash'>;
