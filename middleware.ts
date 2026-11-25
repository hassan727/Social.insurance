import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Session gate — the ONLY entrance to the app. Pages redirect to /login;
// API routes answer 401. Direct database access is closed at the database
// (migration 20261125000007), so every read/write must pass this check and
// then use the server-only service credential.

const SECRET_KEY = new TextEncoder().encode(
  process.env.APP_JWT_SECRET || 'default-fallback-secret-key-32-chars-long!!'
);
const COOKIE_NAME = 'emp_auth_session';

async function hasValidSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET_KEY);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets and framework internals stay open
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/public')
  ) {
    return NextResponse.next();
  }

  // The login API is the one open endpoint — it issues the session
  if (pathname === '/api/auth/login') {
    return NextResponse.next();
  }

  const authed = await hasValidSession(request);

  // Every other API route requires a valid session
  if (pathname.startsWith('/api/')) {
    if (!authed) {
      return NextResponse.json({ error: 'يجب تسجيل الدخول' }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Pages: the login page is reachable only when logged out; everything else
  // requires a session
  if (pathname === '/login') {
    if (authed) {
      return NextResponse.redirect(new URL('/lookup', request.url));
    }
    return NextResponse.next();
  }
  if (!authed) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/lookup', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
