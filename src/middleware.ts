import { jwtVerify } from 'jose';
import { NextRequest, NextResponse } from 'next/server';

function secretKey() {
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

export async function middleware(req: NextRequest) {
  // La page d'integration des bandes-annonces ne donne acces a aucune donnee privee.
  if (req.nextUrl.pathname === '/trailer-player') return NextResponse.next();
  const isLoginPage = req.nextUrl.pathname === '/login';
  const token = req.cookies.get('session')?.value;

  if (!token) {
    return isLoginPage ? NextResponse.next() : NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify(token, secretKey());
    const isAdmin = payload.role === 'ADMIN';

    if (!isAdmin) {
      return isLoginPage ? NextResponse.next() : NextResponse.redirect(new URL('/login', req.url));
    }
    if (isLoginPage) return NextResponse.redirect(new URL('/', req.url));
    return NextResponse.next();
  } catch {
    return isLoginPage ? NextResponse.next() : NextResponse.redirect(new URL('/login', req.url));
  }
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
