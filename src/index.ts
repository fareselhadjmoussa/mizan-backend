import 'dotenv/config';
import express, { ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { prisma } from './lib/prisma';

// Routes
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

app.set('trust proxy', 1);

// ─────────────────────────────────────────────
// ✅ CORS FIX (SAFE & NO CRASH)
// ─────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // السماح للطلبات بدون origin (mobile/postman)
    if (!origin) return callback(null, true);

    // إذا ما في إعداد → اسمح للجميع (مهم لتجنب crash)
    if (allowedOrigins.length === 0) {
      console.warn('⚠️ CORS open (no env configured)');
      return callback(null, true);
    }

    // إذا مسموح
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // ❌ لا ترمي Error → فقط ارفض بهدوء
    console.warn(`❌ Blocked origin: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// مهم جداً للـ preflight
app.options('*', cors());

// ── Middleware ───────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

if (!isProd || process.env.LOG_REQUESTS === 'true') {
  app.use(morgan('dev'));
}

// Rate limit
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Routes ──────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Mizan POS Backend API is running',
  });
});

// Health
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error' });
  }
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/finance', financeRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Error handler
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('🔥 ERROR:', err);

  res.status(500).json({
    success: false,
    error: err instanceof Error ? err.message : 'Internal server error',
  });
};

app.use(errorHandler);

// Start
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});