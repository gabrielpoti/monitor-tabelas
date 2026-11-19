import 'server-only';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || 'https://knvtovsrbyhpcgirgtbl.supabase.co';

let cliente;
export function db() {
  if (!process.env.SUPABASE_SECRET_KEY) throw new Error('Falta a variável SUPABASE_SECRET_KEY na Vercel.');
  cliente ??= createClient(URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  return cliente;
}

// Lê todas as linhas paginando (o Supabase devolve no máximo 1000 por vez).
export async function tudo(montar) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
    if (out.length > 200000) break;
  }
  return out;
}

export async function config(chave) {
  const { data } = await db().from('config').select('valor').eq('chave', chave).maybeSingle();
  return data?.valor ?? null;
}
