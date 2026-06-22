"use strict";
/**
 * 🌱 SEED — Populates the PostgreSQL database (Neon) via Prisma
 * Run: npm run seed
 *
 * Creates:
 *   2 default users (admin + cashier) — only if no users exist yet.
 * Products / sales / stock logs are left empty, same as the previous
 * JSON-based seed — add products from the app once you're logged in.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../src/lib/prisma");
async function seed() {
    console.log('🌱 Seeding PostgreSQL database (Neon)...\n');
    const userCount = await prisma_1.prisma.user.count();
    if (userCount === 0) {
        await prisma_1.prisma.user.createMany({
            data: [
                {
                    name: 'Admin',
                    email: 'admin@pos.com',
                    passwordHash: await bcryptjs_1.default.hash('admin123', 10),
                    role: 'ADMIN',
                    isActive: true,
                },
                {
                    name: 'Cashier One',
                    email: 'cashier@pos.com',
                    passwordHash: await bcryptjs_1.default.hash('cashier123', 10),
                    role: 'CASHIER',
                    isActive: true,
                },
            ],
        });
        console.log('✅ users table seeded (2 users)');
    }
    else {
        console.log('⏭  users table already has data — skipping');
    }
    const productCount = await prisma_1.prisma.product.count();
    console.log(productCount === 0
        ? 'ℹ️  products table is empty — add products from the app'
        : `⏭  products table already has ${productCount} product(s) — skipping`);
    console.log('\n🎉 Seed complete!');
    console.log('👤 Admin:   admin@pos.com   / admin123');
    console.log('\n🐘 Data stored in: PostgreSQL (Neon) via Prisma');
}
seed()
    .catch(err => { console.error('❌ Seed failed:', err); process.exit(1); })
    .finally(async () => { await prisma_1.prisma.$disconnect(); });
