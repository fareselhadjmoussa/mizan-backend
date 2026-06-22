import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { ok, serverError } from '../utils/response';
import { cached } from '../lib/cache';

interface ChartDay {
  date: string;
  total: number;
  count: number;
}

interface TopProduct {
  id: string;
  name: string;
  price: number;
  totalQty: number;
}

interface RecentSale {
  id: string;
  invoiceNo: string;
  total: number;
  paymentType: string;
  createdAt: Date;
  cashier: string;
}

interface Day7Raw {
  date: string;
  total: number;
  count: bigint;
}

const DASHBOARD_CACHE_KEY = 'dashboard:overview';
const DASHBOARD_TTL_MS = 20_000;

export const getDashboard = async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await cached(DASHBOARD_CACHE_KEY, DASHBOARD_TTL_MS, computeDashboard);
    ok(res, data);
  } catch (err) {
    serverError(res, err);
  }
};

async function computeDashboard() {
  const now = new Date();

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const sevenDaysAgo = new Date(todayStart);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const [
    todayAgg,
    weekAgg,
    monthAgg,
    lastMonthAgg,
    totalProducts,
    lowStockCount,
    last7DaysRaw,
    topItemsRaw,
    recentSalesRaw,
  ] = await Promise.all([
    prisma.sale.aggregate({ _sum: { total: true }, _count: true, where: { createdAt: { gte: todayStart } } }),
    prisma.sale.aggregate({ _sum: { total: true }, _count: true, where: { createdAt: { gte: weekStart } } }),
    prisma.sale.aggregate({ _sum: { total: true }, _count: true, where: { createdAt: { gte: monthStart } } }),
    prisma.sale.aggregate({
      _sum: { total: true },
      _count: true,
      where: { createdAt: { gte: lastMonthStart, lte: lastMonthEnd } },
    }),

    prisma.product.count({ where: { isActive: true } }),

    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint as count
      FROM "products"
      WHERE "isActive" = true AND "stock" <= "lowStock"
    `,

    prisma.$queryRaw<Day7Raw[]>`
      SELECT
        to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') as date,
        COALESCE(SUM("total"), 0)::float as total,
        COUNT(*)::bigint as count
      FROM "sales"
      WHERE "createdAt" >= ${sevenDaysAgo}
      GROUP BY 1
      ORDER BY 1
    `,

    prisma.saleItem.groupBy({
      by: ['productId'],
      _sum: { qty: true },
      where: { sale: { createdAt: { gte: monthStart } } },
      orderBy: { _sum: { qty: 'desc' } },
      take: 5,
    }),

    prisma.sale.findMany({
      select: {
        id: true,
        invoiceNo: true,
        total: true,
        paymentType: true,
        createdAt: true,
        user: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);

  // ─────────────────────────────
  // FIX: last 7 days map typing
  // ─────────────────────────────
  const byDate = new Map<string, Day7Raw>(
    last7DaysRaw.map((d: Day7Raw): [string, Day7Raw] => [d.date, d])
  );

  const last7Days: ChartDay[] = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(sevenDaysAgo);
    day.setDate(day.getDate() + i);

    const key = day.toISOString().split('T')[0];
    const row = byDate.get(key);

    return {
      date: key,
      total: row ? Number(row.total) : 0,
      count: row ? Number(row.count) : 0,
    };
  });

  // ─────────────────────────────
  // FIX: top products typing
  // ─────────────────────────────
  const topProductIds = topItemsRaw.map((t: any) => t.productId);

  const topProductDetails = topProductIds.length
    ? await prisma.product.findMany({
        where: { id: { in: topProductIds } },
        select: { id: true, name: true, price: true },
      })
    : [];

  const productMap = new Map<string, (typeof topProductDetails)[number]>(
    topProductDetails.map((p) => [p.id, p])
  );

  const topProducts: TopProduct[] = topItemsRaw.map((t: any) => {
    const p = productMap.get(t.productId);

    return {
      id: t.productId,
      name: p?.name ?? 'Deleted Product',
      price: p ? Number(p.price) : 0,
      totalQty: Number(t._sum?.qty ?? 0),
    };
  });

  // ─────────────────────────────
  // FIX: recent sales typing
  // ─────────────────────────────
  const recentSales: RecentSale[] = recentSalesRaw.map((s: any) => ({
    id: s.id,
    invoiceNo: s.invoiceNo,
    total: Number(s.total),
    paymentType: s.paymentType,
    createdAt: s.createdAt,
    cashier: s.user?.name ?? 'Unknown',
  }));

  const monthTotal = Number(monthAgg._sum.total ?? 0);
  const lastMonthTotal = Number(lastMonthAgg._sum.total ?? 0);

  const revenueGrowth =
    lastMonthTotal > 0
      ? Math.round(((monthTotal - lastMonthTotal) / lastMonthTotal) * 1000) / 10
      : 0;

  return {
    kpis: {
      todayRevenue: Number(todayAgg._sum.total ?? 0),
      todaySales: todayAgg._count,
      weekRevenue: Number(weekAgg._sum.total ?? 0),
      weekSales: weekAgg._count,
      monthRevenue: monthTotal,
      monthSales: monthAgg._count,
      revenueGrowth,
      totalProducts,
      lowStockCount: Number((lowStockCount as any)[0]?.count ?? 0),
    },
    topProducts,
    last7Days,
    recentSales,
  };
}