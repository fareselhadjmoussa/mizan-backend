import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { ok, serverError } from '../utils/response';
import { cached, invalidatePrefix } from '../lib/cache';

// ── Typed shapes ───────────────────────────────────────────────────────────
interface PeriodTotals { revenue: number; tax: number; discount: number; count: number; }
interface RecentSale {
  id: string; invoiceNo: string; total: number; paymentType: string;
  cashPaid?: number; cardPaid?: number; createdAt: Date; cashier: string;
}

const FINANCE_CACHE_KEY = 'finance:summary';
const FINANCE_TTL_MS = 20_000;

// GET /api/finance — full financial overview
//
// Every period total is computed with a single `aggregate()` call in
// Postgres (SUM/COUNT pushed down to the DB), instead of pulling every sale
// row ever created into Node and reducing it five times in memory. See
// project history for why that pattern caused connection-pool exhaustion.
export const getFinanceSummary = async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await cached(FINANCE_CACHE_KEY, FINANCE_TTL_MS, computeFinanceSummary);
    ok(res, data);
  } catch (err) { serverError(res, err); }
};

async function computeFinanceSummary() {
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart  = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart  = new Date(now.getFullYear(), 0, 1);

  const periodAgg = (where: object) =>
    prisma.sale.aggregate({
      _sum: { total: true, tax: true, discount: true },
      _count: true,
      where,
    });

  const toTotals = (a: Awaited<ReturnType<typeof periodAgg>>): PeriodTotals => ({
    revenue:  Number(a._sum.total ?? 0),
    tax:      Number(a._sum.tax ?? 0),
    discount: Number(a._sum.discount ?? 0),
    count:    a._count,
  });

  const [
    allTimeAgg, todayAgg, weekAgg, monthAgg, yearAgg,
    cashAgg, cardAgg, recentRaw,
  ] = await Promise.all([
    periodAgg({}),
    periodAgg({ createdAt: { gte: todayStart } }),
    periodAgg({ createdAt: { gte: weekStart } }),
    periodAgg({ createdAt: { gte: monthStart } }),
    periodAgg({ createdAt: { gte: yearStart } }),
    // Cash/card totals: sum the explicit cashPaid/cardPaid columns where set,
    // falling back to `total` for pure CASH/CARD sales — done as raw SQL so
    // the COALESCE/CASE logic runs in Postgres, not row-by-row in Node.
    prisma.$queryRaw<{ total: number }[]>`
      SELECT COALESCE(SUM(COALESCE("cashPaid", CASE WHEN "paymentType" = 'CASH' THEN "total" ELSE 0 END)), 0)::float as total
      FROM "sales"
    `,
    prisma.$queryRaw<{ total: number }[]>`
      SELECT COALESCE(SUM(COALESCE("cardPaid", CASE WHEN "paymentType" = 'CARD' THEN "total" ELSE 0 END)), 0)::float as total
      FROM "sales"
    `,
    prisma.sale.findMany({
      select: {
        id: true, invoiceNo: true, total: true, paymentType: true,
        cashPaid: true, cardPaid: true, createdAt: true,
        user: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
  ]);

  const allTime = toTotals(allTimeAgg);
  const avgSale = allTime.count > 0 ? allTime.revenue / allTime.count : 0;

  const recentSales: RecentSale[] = recentRaw.map(s => ({
    id: s.id,
    invoiceNo: s.invoiceNo,
    total: Number(s.total),
    paymentType: s.paymentType,
    cashPaid: s.cashPaid ? Number(s.cashPaid) : undefined,
    cardPaid: s.cardPaid ? Number(s.cardPaid) : undefined,
    createdAt: s.createdAt,
    cashier: s.user.name,
  }));

  return {
    allTime,
    today: toTotals(todayAgg),
    week: toTotals(weekAgg),
    month: toTotals(monthAgg),
    year: toTotals(yearAgg),
    cashTotal: Number(cashAgg[0]?.total ?? 0),
    cardTotal: Number(cardAgg[0]?.total ?? 0),
    avgSale,
    recentSales,
  };
}

// POST /api/finance/reset — admin only. Clears all sales/income history.
export const resetFinance = async (_req: Request, res: Response): Promise<void> => {
  try {
    // Sale rows cascade-delete their SaleItem children (see schema.prisma),
    // so a single deleteMany clears the full sales history.
    await prisma.sale.deleteMany();
    invalidatePrefix('finance:');
    invalidatePrefix('dashboard:');
    ok(res, null, 'All financial data has been reset to zero');
  } catch (err) { serverError(res, err); }
};
