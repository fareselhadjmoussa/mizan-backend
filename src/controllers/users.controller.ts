import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { AuthRequest, Role } from '../types';
import { toPublicUser } from '../utils/serialize';
import { ok, created, badRequest, notFound, serverError } from '../utils/response';

const normalizeEmail = (email: unknown) => String(email ?? '').trim().toLowerCase();
const normalizeText = (value: unknown) => String(value ?? '').trim();
const validRoles: Role[] = ['ADMIN', 'CASHIER'];

// GET /api/users
export const getUsers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    ok(res, users.map(toPublicUser));
  } catch (err) { serverError(res, err); }
};

// POST /api/users
export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, password, role } = req.body as { name: string; email: string; password: string; role: Role; };

    const cleanName = normalizeText(name);
    const cleanEmail = normalizeEmail(email);

    if (!cleanName || !cleanEmail || !password) { badRequest(res, 'name, email, password are required'); return; }
    if (password.length < 6) { badRequest(res, 'Password must be at least 6 characters'); return; }
    if (await prisma.user.findUnique({ where: { email: cleanEmail } })) { badRequest(res, 'Email already in use'); return; }

    const user = await prisma.user.create({
      data: {
        name: cleanName,
        email: cleanEmail,
        passwordHash: await bcrypt.hash(password, 10),
        role: validRoles.includes(role) ? role : 'CASHIER',
        isActive: true,
      },
    });

    created(res, toPublicUser(user), 'User created');
  } catch (err) { serverError(res, err); }
};

// PUT /api/users/:id
export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, email, password, role, isActive } = req.body as {
      name?: string; email?: string; password?: string; role?: Role; isActive?: boolean;
    };

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) { notFound(res, 'User not found'); return; }

    const data: { name?: string; email?: string; passwordHash?: string; role?: Role; isActive?: boolean } = {};

    if (name !== undefined) {
      const cleanName = normalizeText(name);
      if (!cleanName) { badRequest(res, 'Name cannot be empty'); return; }
      data.name = cleanName;
    }

    if (email !== undefined) {
      const cleanEmail = normalizeEmail(email);
      if (!cleanEmail) { badRequest(res, 'Email cannot be empty'); return; }
      const duplicate = await prisma.user.findFirst({ where: { email: cleanEmail, id: { not: id } } });
      if (duplicate) { badRequest(res, 'Email already in use'); return; }
      data.email = cleanEmail;
    }

    if (password !== undefined && password !== '') {
      if (password.length < 6) { badRequest(res, 'Password must be at least 6 characters'); return; }
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    if (role !== undefined) {
      if (!validRoles.includes(role)) { badRequest(res, 'Invalid role'); return; }
      data.role = role;
    }

    if (isActive !== undefined) {
      if (id === req.user!.userId && !isActive) { badRequest(res, 'Cannot deactivate your own account'); return; }
      data.isActive = isActive;
    }

    const updated = await prisma.user.update({ where: { id }, data });
    ok(res, toPublicUser(updated), 'User updated');
  } catch (err) { serverError(res, err); }
};

// DELETE /api/users/:id  (soft-delete — sets isActive: false)
export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (id === req.user!.userId) { badRequest(res, 'Cannot deactivate your own account'); return; }
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) { notFound(res, 'User not found'); return; }

    await prisma.user.update({ where: { id }, data: { isActive: false } });
    ok(res, null, 'User deactivated');
  } catch (err) { serverError(res, err); }
};
