import { NextResponse } from 'next/server';
import { assinatura, igual, COOKIE } from '@/lib/auth';

export async function POST(req) {
  const form = await req.formData();
  const senha = String(form.get('senha') || '');
  const volta = String(form.get('volta') || '/');
  const destino = volta.startsWith('/') && !volta.startsWith('//') ? volta : '/';
  await new Promise((r) => setTimeout(r, 400)); // freia tentativas em sequência
  if (!process.env.SITE_PASSWORD || !igual(senha, process.env.SITE_PASSWORD)) {
    return NextResponse.redirect(new URL(`/login?erro=1&volta=${encodeURIComponent(destino)}`, req.url), 303);
  }
  const res = NextResponse.redirect(new URL(destino, req.url), 303);
  res.cookies.set(COOKIE, await assinatura(), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return res;
}
