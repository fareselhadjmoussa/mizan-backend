import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from '../types';
import { serializeProduct } from '../utils/serialize';
import { ok, created, badRequest, notFound, serverError } from '../utils/response';
import { Prisma } from '../generated/prisma';

const normalizeText = (value: unknown): string => String(value ?? '').trim();
const normalizeOptional = (value: unknown): string | null => {
  const v = normalizeText(value);
  return v.length ? v : null;
};
const parseMoney = (value: unknown): number => Number.parseFloat(String(value ?? ''));
const parseIntSafe = (value: unknown, fallback = 0): number => {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

// GET /api/products — search + paginate
export const getProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      search = '',
      lowStock,
      page  = '1',
      limit = '50',
    } = req.query as Record<string, string>;

    const pageNum  = Math.max(1, parseInt(page,  10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
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

    let items = await prisma.product.findMany({ where, orderBy: { name: 'asc' } });
    if (lowStock === 'true') {
      items = items.filter((p) => p.stock <= p.lowStock);
    }

    const total     = items.length;
    const paginated = items.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    ok(res, {
      items: paginated.map(serializeProduct),
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) { serverError(res, err); }
};

// GET /api/products/low-stock
export const getLowStockProducts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const items = (await prisma.product.findMany({ where: { isActive: true } }))
      .filter((p) => p.stock <= p.lowStock)
      .sort((a, b) => a.stock - b.stock);

    ok(res, items.map(serializeProduct));
  } catch (err) { serverError(res, err); }
};

// GET /api/products/barcode/:barcode
export const getByBarcode = async (req: Request, res: Response): Promise<void> => {
  try {
    const barcode = normalizeText(req.params.barcode);
    if (!barcode) { badRequest(res, 'Barcode is required'); return; }
    const product = await prisma.product.findUnique({ where: { barcode } });
    if (!product || !product.isActive) { notFound(res, 'Product not found'); return; }
    ok(res, serializeProduct(product));
  } catch (err) { serverError(res, err); }
};

// GET /api/products/:id
export const getProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product || !product.isActive) { notFound(res, 'Product not found'); return; }

    const logs = await prisma.stockLog.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    ok(res, { ...serializeProduct(product), stockLogs: logs });
  } catch (err) { serverError(res, err); }
};

const nameTaken = async (name: string, excludeId?: string): Promise<boolean> => {
  const match = await prisma.product.findFirst({
    where: {
      isActive: true,
      name: { equals: name.trim(), mode: 'insensitive' },
      ...(excludeId && { id: { not: excludeId } }),
    },
  });
  return !!match;
};

const imageTaken = async (image: string | null, excludeId?: string): Promise<boolean> => {
  if (!image) return false;
  const match = await prisma.product.findFirst({
    where: { isActive: true, image, ...(excludeId && { id: { not: excludeId } }) },
  });
  return !!match;
};

const barcodeTaken = async (barcode: string | null, excludeId?: string): Promise<boolean> => {
  if (!barcode) return false;
  const match = await prisma.product.findFirst({
    where: { barcode, ...(excludeId && { id: { not: excludeId } }) },
  });
  return !!match;
};

// POST /api/products
export const createProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, price, stock, lowStock, barcode, image } = req.body as {
      name: string; price: string; stock?: string; lowStock?: string; barcode?: string; image?: string;
    };

    const cleanName = normalizeText(name);
    const cleanBarcode = normalizeOptional(barcode);
    const cleanImage = normalizeOptional(image);
    const productPrice = parseMoney(price);
    const stockQty = parseIntSafe(stock, 0);
    const lowStockQty = parseIntSafe(lowStock, 5);

    if (!cleanName || !Number.isFinite(productPrice) || productPrice < 0) {
      badRequest(res, 'A valid name and price are required'); return;
    }
    if (stockQty < 0 || lowStockQty < 0) {
      badRequest(res, 'Stock values cannot be negative'); return;
    }
    if (await nameTaken(cleanName)) {
      badRequest(res, 'A product with this name already exists'); return;
    }
    if (await barcodeTaken(cleanBarcode)) {
      badRequest(res, 'Barcode already exists'); return;
    }
    if (await imageTaken(cleanImage)) {
      badRequest(res, 'This image is already used by another product'); return;
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

    if (product.stock > 0) {
      await prisma.stockLog.create({ data: { productId: product.id, delta: product.stock, type: 'RESTOCK', note: 'Initial stock' } });
    }

    created(res, serializeProduct(product), 'Product created');
  } catch (err) { serverError(res, err); }
};

// PUT /api/products/:id
export const updateProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product || !product.isActive) { notFound(res, 'Product not found'); return; }

    const { name, price, lowStock, barcode, image } = req.body as {
      name?: string; price?: string; lowStock?: string; barcode?: string; image?: string;
    };

    const data: Prisma.ProductUpdateInput = {};

    if (name !== undefined) {
      const cleanName = normalizeText(name);
      if (!cleanName) { badRequest(res, 'Product name cannot be empty'); return; }
      if (await nameTaken(cleanName, id)) { badRequest(res, 'A product with this name already exists'); return; }
      data.name = cleanName;
    }

    if (price !== undefined) {
      const productPrice = parseMoney(price);
      if (!Number.isFinite(productPrice) || productPrice < 0) { badRequest(res, 'A valid price is required'); return; }
      data.price = productPrice;
    }

    if (lowStock !== undefined) {
      const lowStockQty = parseIntSafe(lowStock, 0);
      if (lowStockQty < 0) { badRequest(res, 'Low stock value cannot be negative'); return; }
      data.lowStock = lowStockQty;
    }

    if (barcode !== undefined) {
      const cleanBarcode = normalizeOptional(barcode);
      if (await barcodeTaken(cleanBarcode, id)) { badRequest(res, 'Barcode already used by another product'); return; }
      data.barcode = cleanBarcode;
    }

    if (image !== undefined) {
      const cleanImage = normalizeOptional(image);
      if (await imageTaken(cleanImage, id)) { badRequest(res, 'This image is already used by another product'); return; }
      data.image = cleanImage;
    }

    const updated = await prisma.product.update({ where: { id }, data });
    ok(res, serializeProduct(updated), 'Product updated');
  } catch (err) { serverError(res, err); }
};

// DELETE /api/products/:id  (soft delete — keeps history intact)
export const deleteProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) { notFound(res, 'Product not found'); return; }

    await prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } });
    ok(res, null, 'Product deleted');
  } catch (err) { serverError(res, err); }
};
