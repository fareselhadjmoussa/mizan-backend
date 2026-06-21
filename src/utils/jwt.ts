import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';

const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET?.trim();

  if (secret) return secret;

  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[AUTH WARNING] JWT_SECRET is missing. Using a local development fallback. Create backend/.env for a fixed secret.'
    );
    return 'local-dev-jwt-secret-change-me';
  }

  throw new Error('JWT_SECRET is required in production. Add it to backend/.env');
};

const getJwtExpiresIn = (): jwt.SignOptions['expiresIn'] => {
  return (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];
};

export const signToken = (payload: JwtPayload): string =>
  jwt.sign(payload, getJwtSecret(), { expiresIn: getJwtExpiresIn() });

export const verifyToken = (token: string): JwtPayload =>
  jwt.verify(token, getJwtSecret()) as JwtPayload;
