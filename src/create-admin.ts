import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma';

async function main() {
  const passwordHash = await bcrypt.hash('bachir', 10);

  await prisma.user.create({
    data: {
      name: 'Bachir',
      email: 'bachirelhadjmoussa@gmail.com',
      passwordHash,
      role: 'ADMIN',
      isActive: true
    }
  });

  console.log('Admin created successfully');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });