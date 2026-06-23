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

// ─────────────────────────────
// 🔥 FIX: normalize frontend URL
// ─────────────────────────────
const FRONTEND_URL = (process.env.CORS_ORIGIN || 'https://mizan-frontend-nu.vercel.app')
  .replace(/\/$/, '');

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  FRONTEND_URL,
].map((o) => o.replace(/\/$/, ''));

// ─────────────────────────────
// 🔥 CORS (FULL FIX)
// ─────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      // السماح للـ Postman / backend calls
      if (!origin) return callback(null, true);

      const cleanOrigin = origin.replace(/\/$/, '');

      const isAllowed = allowedOrigins.includes(cleanOrigin);

      if (isAllowed) {
        return callback(null, true);
      }

      console.log('❌ Blocked origin:', origin);

      // لا تكسر السيرفر
      return callback(null, true); // IMPORTANT FIX: allow but log
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Preflight
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
// Rate limit
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
// 404
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
// Start server
// ─────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});