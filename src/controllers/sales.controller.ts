import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest, PayType } from '../types';
import { serializeSale } from '../utils/serialize';
import { ok, created, badRequest, notFound, serverError } from '../utils/response';
import { generateInvoiceNo } from '../utils/invoice';
import { invalidatePrefix } from '../lib/cache';

interface CreateSaleBody {
  items: Array<{
    productId: string;
    qty: number;
    unitPrice?: number;
    discount?: number;
  }>;
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
};

class BadRequestError extends Error {}

const money = (n: number) => Math.round(n * 100) / 100;

const validPaymentTypes: PayType[] = ['CASH', 'CARD', 'MIXED'];

export const createSale = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = req.body as CreateSaleBody;

    const { items, paymentType, note } = body;
    const taxPercent = Number(body.tax ?? 0);
    const globalDiscount = Number(body.discount ?? 0);

    if (!items?.length) {
      badRequest(res, 'items array is required');
      return;
    }

    if (!validPaymentTypes.includes(paymentType)) {
      badRequest(res, 'Invalid paymentType');
      return;
    }

    if (taxPercent < 0 || taxPercent > 100) {
      badRequest(res, 'Tax must be 0-100');
      return;
    }

    if (globalDiscount < 0) {
      badRequest(res, 'Discount cannot be negative');
      return;
    }

    const normalizedItems = items.map((item) => ({
      productId: String(item.productId).trim(),
      qty: Number(item.qty),
      discount: Number(item.discount ?? 0),
    }));

    const invoiceNo = generateInvoiceNo();

    const sale = await prisma.$transaction(async (tx) => {
      const productIds = [...new Set(normalizedItems.map(i => i.productId))];

      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
      });

      const productMap = new Map(products.map(p => [p.id, p]));

      for (const item of normalizedItems) {
        const product = productMap.get(item.productId);
        if (!product) throw new BadRequestError('Product not found');
        if (!product.isActive) throw new BadRequestError('Product inactive');
        if (product.stock < item.qty) throw new BadRequestError('Not enough stock');
      }

      const lineItems = normalizedItems.map((item) => {
        const product = productMap.get(item.productId)!;
        const unitPrice = Number(product.price);
        const lineSubtotal = unitPrice * item.qty;

        if (item.discount > lineSubtotal) {
          throw new BadRequestError('Invalid discount');
        }

        return { ...item, unitPrice, lineSubtotal };
      });

      const subtotal = money(
        lineItems.reduce((sum, i) => sum + i.lineSubtotal - i.discount, 0)
      );

      const taxAmount = money(subtotal * (taxPercent / 100));
      const total = money(subtotal + taxAmount - globalDiscount);

      const createdSale = await tx.sale.create({
        data: {
          invoiceNo,
          subtotal,
          tax: taxPercent,
          discount: globalDiscount,
          total,
          paymentType,
          cashPaid: body.cashPaid ? Number(body.cashPaid) : null,
          cardPaid: body.cardPaid ? Number(body.cardPaid) : null,
          note: note ? String(note) : undefined,
          userId: req.user!.userId,
          items: {
            create: lineItems.map(i => ({
              productId: i.productId,
              qty: i.qty,
              unitPrice: i.unitPrice,
              discount: i.discount,
            })),
          },
        },
        include: saleInclude,
      });

      for (const item of lineItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.qty } },
        });
      }

      await tx.stockLog.createMany({
        data: lineItems.map(i => ({
          productId: i.productId,
          delta: -i.qty,
          type: 'SALE',
          note: `Sale #${invoiceNo}`,
        })),
      });

      return createdSale;
    });

    invalidatePrefix('dashboard:');
    invalidatePrefix('finance:');

    created(res, serializeSale(sale), 'Sale completed');
    return;

  } catch (err: any) {
    if (err instanceof BadRequestError) {
      badRequest(res, err.message);
      return;
    }
    serverError(res, err);
    return;
  }
};

export const getSales = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '20', paymentType } = req.query as any;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const where: any = {
      ...(paymentType && { paymentType }),
    };

    const [total, sales] = await Promise.all([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        include: saleInclude,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * limitNum,
        take: limitNum,
      }),
    ]);

    ok(res, {
      items: sales.map(serializeSale),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });

    return;
  } catch (err) {
    serverError(res, err);
    return;
  }
};

export const getSale = async (req: Request, res: Response): Promise<void> => {
  try {
    const sale = await prisma.sale.findUnique({
      where: { id: req.params.id },
      include: saleInclude,
    });

    if (!sale) {
      notFound(res, 'Sale not found');
      return;
    }

    ok(res, serializeSale(sale));
    return;

  } catch (err) {
    serverError(res, err);
    return;
  }
};