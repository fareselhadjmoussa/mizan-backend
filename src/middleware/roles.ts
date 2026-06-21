import { Response, NextFunction } from 'express';
import { AuthRequest, Role } from '../types';   // ← from our own types, not Prisma
import { forbidden } from '../utils/response';

export const requireRole = (...roles: Role[]) =>
  (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      forbidden(res, 'Insufficient permissions');
      return;
    }
    next();
  };

export const adminOnly = requireRole('ADMIN');
