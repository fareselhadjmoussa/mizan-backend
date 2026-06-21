import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { signToken } from '../utils/jwt';
import { ok, badRequest, unauthorized, serverError } from '../utils/response';
import { AuthRequest } from '../types';

// POST /api/auth/login
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) { badRequest(res, 'Email and password required'); return; }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) { unauthorized(res, 'Invalid credentials'); return; }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) { unauthorized(res, 'Invalid credentials'); return; }

    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    ok(res, {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    }, 'Login successful');
  } catch (err) { serverError(res, err); }
};

// GET /api/auth/me
export const me = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) { unauthorized(res); return; }
    // Return safe user — no passwordHash
    ok(res, {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    });
  } catch (err) { serverError(res, err); }
};

// PUT /api/auth/change-password
export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) { unauthorized(res); return; }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) { badRequest(res, 'Current password is incorrect'); return; }
    if (!newPassword || newPassword.length < 6) {
      badRequest(res, 'New password must be at least 6 characters'); return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });

    ok(res, null, 'Password changed successfully');
  } catch (err) { serverError(res, err); }
};
