# Mizan POS Backend

Express + Prisma + PostgreSQL backend.

## Local

```bash
npm install
cp .env.example .env
npx prisma migrate deploy
npm run seed
npm run dev
```

## Render

- Root Directory: `backend`
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`

Required env vars:

```txt
DATABASE_URL=...
JWT_SECRET=...
JWT_EXPIRES_IN=7d
NODE_ENV=production
CORS_ORIGIN=https://your-frontend.vercel.app
```
