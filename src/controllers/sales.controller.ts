import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest, PayType } from '../types';
import { serializeSale } from '../utils/serialize';
import { ok, created, badRequest, notFound, serverError } from '../utils/response';
import { generateInvoiceNo } from '../utils/invoice';
import { Prisma } from '../generated/prisma/client';
import { invalidatePrefix } from '../lib/cache';

interface CreateSaleBody {
  items: Array<{ productId: string; qty: number; unitPrice?: number; discount?: number; }>;
  tax?: number;
  discount?: number;
  paymentType: PayType;
  cashPaid?: number;
  cardPaid?: number;
  note?: string;
}

const saleInclude = {
  user: true,
  items: { include: { product: true } },
} satisfies Prisma.SaleInclude;

class BadRequestError extends Error {}

const money = (n: number) => Math.round(n * 100) / 100;
const readOptionalNumber = (value: unknown): number | undefined =>
  value === undefined || value === null || value === '' ? undefined : Number(value);
const validPaymentTypes: PayType[] = ['CASH', 'CARD', 'MIXED'];

// POST /api/sales
export const createSale = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateSaleBody;
    const { items, paymentType, note } = body;
    const taxPercent = Number(body.tax ?? 0);
    const globalDiscount = Number(body.discount ?? 0);

    if (!items?.length) { badRequest(res, 'items array is required'); return; }
    if (!validPaymentTypes.includes(paymentType)) { badRequest(res, 'Valid paymentType is required'); return; }
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) { badRequest(res, 'Tax must be between 0 and 100'); return; }
    if (!Number.isFinite(globalDiscount) || globalDiscount < 0) { badRequest(res, 'Discount cannot be negative'); return; }

    const normalizedItems = items.map((item) => ({
      productId: String(item.productId || '').trim(),
      qty: Number(item.qty),
      discount: Number(item.discount ?? 0),
    }));

    if (normalizedItems.some(i => !i.productId || !Number.isInteger(i.qty) || i.qty <= 0 || !Number.isFinite(i.discount) || i.discount < 0)) {
      badRequest(res, 'Every item needs a valid productId, positive qty and non-negative discount'); return;
    }

    const invoiceNo = generateInvoiceNo();

    const sale = await prisma.$transaction(async (tx) => {
      const productIds = [...new Set(normalizedItems.map(i => i.productId))];
      const products = await tx.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(products.map(p => [p.id, p]));

      for (const item of normalizedItems) {
        const product = productMap.get(item.productId);
        if (!product) throw new BadRequestError(`Product ${item.productId} not found`);
        if (!product.isActive) throw new BadRequestError(`Product "${product.name}" is no longer available`);
        if (product.stock < item.qty) throw new BadRequestError(`Not enough stock for "${product.name}" (available: ${product.stock})`);
      }

      const lineItems = normalizedItems.map((item) => {
        const product = productMap.get(item.productId)!;
        const unitPrice = Number(product.price);
        const lineSubtotal = unitPrice * item.qty;
        if (item.discount > lineSubtotal) throw new BadRequestError(`Discount is too high for "${product.name}"`);
        return { ...item, unitPrice, lineSubtotal };
      });

      const subtotal = money(lineItems.reduce((sum, item) => sum + item.lineSubtotal - item.discount, 0));
      if (globalDiscount > subtotal) throw new BadRequestError('Global discount cannot exceed subtotal');
      const taxAmount = money(subtotal * (taxPercent / 100));
      const total = money(subtotal + taxAmount - globalDiscount);

      const cashPaidRaw = readOptionalNumber(body.cashPaid);
      const cardPaidRaw = readOptionalNumber(body.cardPaid);
      const cashPaid = cashPaidRaw === undefined ? undefined : money(cashPaidRaw);
      const cardPaid = cardPaidRaw === undefined ? undefined : money(cardPaidRaw);

      if ((cashPaid !== undefined && (!Number.isFinite(cashPaid) || cashPaid < 0)) || (cardPaid !== undefined && (!Number.isFinite(cardPaid) || cardPaid < 0))) {
        throw new BadRequestError('Payment values cannot be negative');
      }

      const computedCashPaid = paymentType === 'CASH' ? money(cashPaid ?? total) : paymentType === 'MIXED' ? money(cashPaid ?? 0) : undefined;
      const computedCardPaid = paymentType === 'CARD' ? total : paymentType === 'MIXED' ? money(cardPaid ?? Math.max(total - (computedCashPaid ?? 0), 0)) : undefined;

      if (paymentType === 'CASH' && (computedCashPaid ?? 0) < total) throw new BadRequestError('Cash paid is less than total');
      if (paymentType === 'MIXED' && money((computedCashPaid ?? 0) + (computedCardPaid ?? 0)) < total) throw new BadRequestError('Mixed payment is less than total');

      const createdSale = await tx.sale.create({
        data: {
          invoiceNo,
          subtotal,
          tax: taxPercent,
          discount: globalDiscount,
          total,
          paymentType,
          cashPaid: computedCashPaid,
          cardPaid: computedCardPaid,
          note: note ? String(note).trim() : undefined,
          userId: req.user!.userId,
          items: {
            create: lineItems.map(i => ({ productId: i.productId, qty: i.qty, unitPrice: i.unitPrice, discount: i.discount })),
          },
        },
        include: saleInclude,
      });

      for (const item of lineItems) {
        await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.qty } } });
      }

      await tx.stockLog.createMany({
        data: lineItems.map(i => ({ productId: i.productId, delta: -i.qty, type: 'SALE' as const, note: `Sale #${invoiceNo}` })),
      });

      return createdSale;
    });

    invalidatePrefix('dashboard:');
    invalidatePrefix('finance:');
    created(res, serializeSale(sale), 'Sale completed');
  } catch (err) {
    if (err instanceof BadRequestError) { badRequest(res, err.message); return; }
    serverError(res, err);
  }
};

// GET /api/sales
export const getSales = async (req: Request, res: Response): Promise<void> => {
  try {
    const { from, to, paymentType, page = '1', limit = '20' } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page,  10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));

    const where: Prisma.SaleWhereInput = {
      ...(paymentType && { paymentType: paymentType as PayType }),
      ...((from || to) && { createdAt: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(`${to}T23:59:59`) }) } }),
    };

    const [total, sales] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({ where, include: saleInclude, orderBy: { createdAt: 'desc' }, skip: (pageNum - 1) * limitNum, take: limitNum }),
    ]);

    ok(res, { items: sales.map(serializeSale), total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) });
  } catch (err) { serverError(res, err); }
};

// GET /api/sales/:id
export const getSale = async (req: Request, res: Response): Promise<void> => {
  try {
    const sale = await prisma.sale.findUnique({ where: { id: req.params.id }, include: saleInclude });
    if (!sale) { notFound(res, 'Sale not found'); return; }
    ok(res, serializeSale(sale));
  } catch (err) { serverError(res, err); }
};
