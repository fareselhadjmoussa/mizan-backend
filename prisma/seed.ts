/**
 * 🌱 SEED — Populates the PostgreSQL database (Neon) via Prisma
 * Run: npm run seed
 *
 * Creates:
 *   2 default users (admin + cashier) — only if no users exist yet.
 * Products / sales / stock logs are left empty, same as the previous
 * JSON-based seed — add products from the app once you're logged in.
 */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';

async function seed() {
  console.log('🌱 Seeding PostgreSQL database (Neon)...\n');

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    await prisma.user.createMany({
      data: [
        {
          name: 'Admin',
          email: 'admin@pos.com',
          passwordHash: await bcrypt.hash('admin123', 10),
          role: 'ADMIN',
          isActive: true,
        },
        {
          name: 'Cashier One',
          email: 'cashier@pos.com',
          passwordHash: await bcrypt.hash('cashier123', 10),
          role: 'CASHIER',
          isActive: true,
        },
      ],
    });
    console.log('✅ users table seeded (2 users)');
  } else {
    console.log('⏭  users table already has data — skipping');
  }

  const productCount = await prisma.product.count();
  console.log(
    productCount === 0
      ? 'ℹ️  products table is empty — add products from the app'
      : `⏭  products table already has ${productCount} product(s) — skipping`
  );

  console.log('\n🎉 Seed complete!');
  console.log('👤 Admin:   admin@pos.com   / admin123');
  console.log('\n🐘 Data stored in: PostgreSQL (Neon) via Prisma');
}

seed()
  .catch(err => { console.error('❌ Seed failed:', err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
