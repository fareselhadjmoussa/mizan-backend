import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { LogType, AuthRequest } from '../types';
import { serializeProduct } from '../utils/serialize';
import { ok, badRequest, serverError } from '../utils/response';
import { invalidatePrefix } from '../lib/cache';

// GET /api/inventory
export const getInventory = async (_req: Request, res: Response): Promise<void> => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    const summary = {
      totalProducts:   products.length,
      totalValue:      products.reduce((s, p) => s + Number(p.price) * p.stock, 0),
      lowStockCount:   products.filter(p => p.stock > 0 && p.stock <= p.lowStock).length,
      outOfStockCount: products.filter(p => p.stock === 0).length,
    };

    ok(res, { products: products.map(serializeProduct), summary });
  } catch (err) { serverError(res, err); }
};

// POST /api/inventory/adjust
export const adjustStock = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId, delta, type, note } = req.body as {
      productId: string;
      delta: number;
      type: LogType;
      note?: string;
    };

    if (!productId || delta === undefined || !type) {
      badRequest(res, 'productId, delta, type are required'); return;
    }

    const validTypes: LogType[] = ['SALE', 'RESTOCK', 'ADJUSTMENT'];
    if (!validTypes.includes(type)) {
      badRequest(res, `type must be one of: ${validTypes.join(', ')}`); return;
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) { badRequest(res, 'Product not found'); return; }

    const numDelta = Number(delta);
    const newStock = product.stock + numDelta;
    if (newStock < 0) {
      badRequest(res, `Cannot reduce below 0 (current stock: ${product.stock})`); return;
    }

    const [updated] = await prisma.$transaction([
      prisma.product.update({ where: { id: productId }, data: { stock: newStock } }),
      prisma.stockLog.create({ data: { productId, delta: numDelta, type, note } }),
    ]);

    invalidatePrefix('dashboard:');
    ok(res, serializeProduct(updated), 'Stock adjusted');
  } catch (err) { serverError(res, err); }
};

// GET /api/inventory/logs/:productId
export const getStockLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const logs = await prisma.stockLog.findMany({
      where: { productId: req.params.productId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    ok(res, logs);
  } catch (err) { serverError(res, err); }
};
