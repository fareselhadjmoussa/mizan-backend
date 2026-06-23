import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../types';
import { serializeProduct } from '../utils/serialize';
import {
  ok,
  created,
  badRequest,
  notFound,
  serverError,
} from '../utils/response';
import { Prisma } from '@prisma/client';

// ─────────────────────────────
// Types
// ─────────────────────────────
interface CreateProductBody {
  name: string;
  price: string | number;
  stock?: number;
  lowStock?: number;
  barcode?: string;
  image?: string;
}

interface UpdateProductBody {
  name?: string;
  price?: string | number;
  lowStock?: number;
  barcode?: string;
  image?: string;
}

// ─────────────────────────────
// Helpers
// ─────────────────────────────
const normalizeText = (value: unknown): string =>
  String(value ?? '').trim();

const normalizeOptional = (value: unknown): string | null => {
  const v = normalizeText(value);
  return v.length ? v : null;
};

const parseMoney = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const parseIntSafe = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

// ─────────────────────────────
// GET /products
// ─────────────────────────────
export const getProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      search = '',
      lowStock,
      page = '1',
      limit = '50',
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const cleanSearch = normalizeText(search);

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(cleanSearch && {
        OR: [
          { name: { contains: cleanSearch, mode: 'insensitive' } },
          { barcode: { contains: cleanSearch } },
        ],
      }),
    };

    let items = await prisma.product.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    if (lowStock === 'true') {
      items = items.filter((p) => p.stock <= p.lowStock);
    }

    const total = items.length;

    const paginated = items.slice(
      (pageNum - 1) * limitNum,
      pageNum * limitNum
    );

    ok(res, {
      items: paginated.map(serializeProduct),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    serverError(res, err);
  }
};

// ─────────────────────────────
// GET low stock
// ─────────────────────────────
export const getLowStockProducts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const items = await prisma.product.findMany({
      where: { isActive: true },
    });

    const filtered = items
      .filter((p) => p.stock <= p.lowStock)
      .sort((a, b) => a.stock - b.stock);

    ok(res, filtered.map(serializeProduct));
  } catch (err) {
    serverError(res, err);
  }
};

// ─────────────────────────────
// GET by barcode
// ─────────────────────────────
export const getByBarcode = async (req: Request, res: Response): Promise<void> => {
  try {
    const barcode = normalizeText(req.params.barcode);

    if (!barcode) {
      badRequest(res, 'Barcode is required');
      return;
    }

    const product = await prisma.product.findUnique({
      where: { barcode },
    });

    if (!product || !product.isActive) {
      notFound(res, 'Product not found');
      return;
    }

    ok(res, serializeProduct(product));
  } catch (err) {
    serverError(res, err);
  }
};

// ─────────────────────────────
// GET by id
// ─────────────────────────────
export const getProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
    });

    if (!product || !product.isActive) {
      notFound(res, 'Product not found');
      return;
    }

    const logs = await prisma.stockLog.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    ok(res, {
      ...serializeProduct(product),
      stockLogs: logs,
    });
  } catch (err) {
    serverError(res, err);
  }
};

// ─────────────────────────────
// CREATE product
// ─────────────────────────────
export const createProduct = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { name, price, stock, lowStock, barcode, image } =
      req.body as CreateProductBody;

    const cleanName = normalizeText(name);
    const cleanBarcode = normalizeOptional(barcode);
    const cleanImage = normalizeOptional(image);

    const productPrice = parseMoney(price);
    const stockQty = parseIntSafe(stock, 0);
    const lowStockQty = parseIntSafe(lowStock, 5);

    if (!cleanName || productPrice <= 0) {
      badRequest(res, 'Invalid name or price');
      return;
    }

    const exists = await prisma.product.findFirst({
      where: { name: cleanName, isActive: true },
    });

    if (exists) {
      badRequest(res, 'Product already exists');
      return;
    }

    const product = await prisma.product.create({
      data: {
        name: cleanName,
        price: productPrice,
        stock: stockQty,
        lowStock: lowStockQty,
        barcode: cleanBarcode,
        image: cleanImage,
        isActive: true,
      },
    });

    created(res, serializeProduct(product), 'Product created');
  } catch (err) {
    serverError(res, err);
  }
};

// ─────────────────────────────
// UPDATE product
// ─────────────────────────────
export const updateProduct = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({ where: { id } });

    if (!product || !product.isActive) {
      notFound(res, 'Product not found');
      return;
    }

    const { name, price, lowStock, barcode, image } =
      req.body as UpdateProductBody;

    const data: Prisma.ProductUpdateInput = {};

    if (name !== undefined) data.name = normalizeText(name);
    if (price !== undefined) data.price = parseMoney(price);
    if (lowStock !== undefined)
      data.lowStock = parseIntSafe(lowStock);

    if (barcode !== undefined)
      data.barcode = normalizeOptional(barcode);

    if (image !== undefined)
      data.image = normalizeOptional(image);

    const updated = await prisma.product.update({
      where: { id },
      data,
    });

    ok(res, serializeProduct(updated), 'Product updated');
  } catch (err) {
    serverError(res, err);
  }
};

// ─────────────────────────────
// DELETE (soft)
// ─────────────────────────────
export const deleteProduct = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({ where: { id } });

    if (!product) {
      notFound(res, 'Product not found');
      return;
    }

    await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    ok(res, null, 'Product deleted');
  } catch (err) {
    serverError(res, err);
  }
};