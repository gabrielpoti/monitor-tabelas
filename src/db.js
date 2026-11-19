import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

if (!SUPABASE_KEY) throw new Error('Falta o secret SUPABASE_SERVICE_ROLE_KEY');

export const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// Lê uma tabela inteira paginando de 1000 em 1000.
export async function lerTudo(tabela, colunas = '*', filtro = (q) => q) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(db.from(tabela).select(colunas)).range(de, de + 999);
    if (error) throw new Error(`Lendo ${tabela}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// Upsert em blocos.
export async function gravar(tabela, linhas, onConflict) {
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await db.from(tabela).upsert(linhas.slice(i, i + 500), onConflict ? { onConflict } : undefined);
    if (error) throw new Error(`Gravando ${tabela}: ${error.message}`);
  }
}

export async function inserir(tabela, linhas) {
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await db.from(tabela).insert(linhas.slice(i, i + 500));
    if (error) throw new Error(`Inserindo em ${tabela}: ${error.message}`);
  }
}

export async function getConfig(chave) {
  const { data } = await db.from('config').select('valor').eq('chave', chave).maybeSingle();
  return data?.valor ?? null;
}
export async function setConfig(chave, valor) {
  const { error } = await db.from('config').upsert({ chave, valor: valor == null ? null : String(valor) });
  if (error) throw new Error(`config ${chave}: ${error.message}`);
}
