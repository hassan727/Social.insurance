import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Public access — the owner approved opening the app with no login page
// (2026-11-25, explicit WhatsApp confirmation after disclosure that anyone
// with the URL can read/write employee data). Direct database access stays
// closed at the database (migration 20261125000007); every read/write still
// flows through the server-only service credential.

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/' || pathname === '/login') {
    return NextResponse.redirect(new URL('/lookup', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
