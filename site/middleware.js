import { NextResponse } from 'next/server';
import { assinatura, igual, COOKIE } from './lib/auth';

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname.startsWith('/api/login')) return NextResponse.next();
  const esperado = await assinatura();
  const atual = req.cookies.get(COOKIE)?.value;
  if (esperado && igual(atual, esperado)) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ erro: 'Faça login' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = esperado ? `?volta=${encodeURIComponent(pathname + req.nextUrl.search)}` : '?semSenha=1';
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'] };
