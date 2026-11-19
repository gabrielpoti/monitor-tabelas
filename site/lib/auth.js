// Sessão simples: cookie com HMAC da senha do site (SITE_PASSWORD). Funciona no middleware (Edge) e no servidor.
const enc = new TextEncoder();

export async function assinatura() {
  const senha = process.env.SITE_PASSWORD;
  if (!senha) return null;
  const chave = await crypto.subtle.importKey('raw', enc.encode(senha), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', chave, enc.encode('monitor-tabelas:sessao:v1'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function igual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const COOKIE = 'mt_sessao';
