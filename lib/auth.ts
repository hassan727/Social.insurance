import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const SECRET_KEY = new TextEncoder().encode(
  process.env.APP_JWT_SECRET || 'default-fallback-secret-key-32-chars-long!!'
);

const COOKIE_NAME = 'emp_auth_session';

export async function createSessionToken(): Promise<string> {
  return await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(SECRET_KEY);
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, SECRET_KEY);
    return true;
  } catch {
    return false;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return false;
  return await verifySessionToken(token);
}

export function validateLoginCredentials(user: string, pass: string): boolean {
  const expectedUser = process.env.APP_ADMIN_USER || 'admin';
  const expectedPass = process.env.APP_ADMIN_PASSWORD || 'admin@insurance2026';
  return user.trim() === expectedUser && pass === expectedPass;
}

export const AUTH_COOKIE_NAME = COOKIE_NAME;
