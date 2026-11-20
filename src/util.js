import { LIMITE_MINUTOS } from './config.js';

const INICIO = Date.now();
export const tempoAcabou = () => Date.now() - INICIO > LIMITE_MINUTOS * 60 * 1000;
export const msRestantes = () => LIMITE_MINUTOS * 60 * 1000 - (Date.now() - INICIO);
export const minutos = () => ((Date.now() - INICIO) / 60000).toFixed(1);

export const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[’'`´-]/g, ' ').replace(/\s+/g, ' ').trim();

export let ultimoLog = 'iniciando';
export const log = (...a) => { ultimoLog = a.join(' '); console.log(`[${minutos()}min]`, ...a); };

// Executa fn em todos os itens com as chamadas limitadas pela fila do cliente.
export async function emParalelo(itens, fn) {
  return Promise.all(itens.map((x, i) => fn(x, i).catch((e) => ({ __erro: e }))));
}

export const brl = (v) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = (a, b) => (a && b != null) ? ((b - a) / a) * 100 : null;

// JSON estável para comparar conteúdos.
export const estavel = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v))
  ? Object.keys(v).sort().reduce((acc, kk) => { acc[kk] = v[kk]; return acc; }, {}) : v);

export function agrupar(lista, chaveFn) {
  const m = new Map();
  for (const x of lista) { const k = chaveFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
