import 'dotenv/config';
import express, { ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { prisma } from './lib/prisma';

// ── Routes ────────────────────────────────────────────────────────────────────
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import productRoutes from './routes/products';
import salesRoutes from './routes/sales';
import inventoryRoutes from './routes/inventory';
import dashboardRoutes from './routes/dashboard';
import financeRoutes from './routes/finance';

const app = express();
const PORT = Number(process.env.PORT || 5000);
const isProd = process.env.NODE_ENV === 'production';

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Render, Fly, Railway, Nginx and most production hosts run behind proxies.
app.set('trust proxy', 1);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
}));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
if (!isProd || process.env.LOG_REQUESTS === 'true') app.use(morgan('dev'));

// ── Friendly root ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Mizan POS Backend API is running',
    health: '/health',
    api: '/api',
  });
});

// ── Health check ──────────────────────────────────────────────────────────────
const healthHandler = async (_req: express.Request, res: express.Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', storage: 'PostgreSQL (Neon) via Prisma', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      storage: 'PostgreSQL (Neon) via Prisma',
      error: err instanceof Error ? err.message : 'Database connection failed',
    });
  }
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/users',     userRoutes);
app.use('/api/products',  productRoutes);
app.use('/api/sales',     salesRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/finance',   financeRoutes);

// ── 404 + error handler ───────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ success: false, error: 'Route not found' }));

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('[EXPRESS ERROR]', err);
  res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' });
};
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Mizan POS Backend running on http://0.0.0.0:${PORT}`);
  console.log('🐘 Storage: PostgreSQL (Neon) via Prisma');
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
const shutdown = async () => {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;
