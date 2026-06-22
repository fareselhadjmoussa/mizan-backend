import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error'],
  });

// في التطوير فقط نعيد استخدام نفس الاتصال
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}