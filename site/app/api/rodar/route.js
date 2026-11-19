import { NextResponse } from 'next/server';

const REPO = process.env.GITHUB_REPO || 'gabrielpoti/monitor-tabelas';
const MODOS = ['diario', 'semanal', 'rede', 'area', 'cidades', 'teste'];

export async function POST(req) {
  const modo = String((await req.formData()).get('modo') || '');
  const volta = (q) => NextResponse.redirect(new URL(`/?${q}`, req.url), 303);
  if (!MODOS.includes(modo)) return volta('erroRodar=modo inválido');
  if (!process.env.GITHUB_TOKEN) return volta(`erroRodar=${encodeURIComponent('falta a variável GITHUB_TOKEN na Vercel (veja o README).')}`);
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/monitor.yml/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    body: JSON.stringify({ ref: 'main', inputs: { modo } }),
  });
  if (!r.ok) return volta(`erroRodar=${encodeURIComponent(`GitHub respondeu ${r.status}`)}`);
  return volta(`rodou=${modo}`);
}
