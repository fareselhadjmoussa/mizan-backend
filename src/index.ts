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

const FRONTEND_URL = process.env.CORS_ORIGIN || 'https://mizan-frontend-nu.vercel.app';

// ─────────────────────────────
// ✅ CORS FIX FINAL (production safe)
// ─────────────────────────────
const allowedOrigins = new Set<string>([
  'http://localhost:3000',
  'http://localhost:5173',
  FRONTEND_URL,
]);

app.use(
  cors({
    origin: (origin, callback) => {
      // السماح للطلبات بدون origin (Postman / mobile / server-to-server)
      if (!origin) return callback(null, true);

      if (allowedOrigins.has(origin)) {
        return callback(null, true);
      }

      console.log('❌ Blocked origin:', origin);

      // لا نكسر السيرفر، فقط نمنع CORS
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// مهم جدًا لـ preflight
app.options('*', cors());

// ─────────────────────────────
// Middleware
// ─────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

if (!isProd || process.env.LOG_REQUESTS === 'true') {
  app.use(morgan('dev'));
}

// ─────────────────────────────
// Rate limit (auth فقط)
// ─────────────────────────────
app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// ─────────────────────────────
// Routes
// ─────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Mizan POS Backend API is running',
  });
});

// Health check
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('❌ DB Health Error:', err);
    res.status(500).json({ status: 'error', db: 'down' });
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

// ─────────────────────────────
// 404 handler
// ─────────────────────────────
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

// ─────────────────────────────
// Error handler
// ─────────────────────────────
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error('🔥 ERROR:', err);

  res.status(500).json({
    success: false,
    error: err instanceof Error ? err.message : 'Internal server error',
  });
};

app.use(errorHandler);

// ─────────────────────────────
// Start server (Render safe)
// ─────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});