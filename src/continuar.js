// Roda no fim de cada execução do monitor: se há uma prioridade com rede pendente e nada mais na fila,
// dispara a continuação. Se houver outra execução na fila (ex.: o diário), não dispara — ela mesma, ao
// terminar, passa por aqui e dispara a continuação. Assim a prioridade nunca derruba o diário da fila.
import { getConfig } from './db.js';

const valor = await getConfig('prioridade_pendente');
let fila; try { fila = JSON.parse(valor); } catch { fila = valor; }
const grupo = Array.isArray(fila) ? fila[0] : fila;
if (!grupo) { console.log('Nenhuma prioridade pendente.'); process.exit(0); }
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
const api = (p, init = {}) => fetch(`https://api.github.com/repos/${repo}${p}`, {
  ...init, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', ...(init.headers || {}) },
});
for (const status of ['queued', 'pending', 'waiting']) {
  const j = await (await api(`/actions/workflows/monitor.yml/runs?status=${status}&per_page=5`)).json();
  if ((j.total_count || 0) > 0) { console.log(`Já há execução na fila (${status}); ela continua a prioridade de ${grupo} depois.`); process.exit(0); }
}
const r = await api('/actions/workflows/monitor.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { modo: 'prioridade', grupo } }) });
console.log(`Continuação da prioridade ${grupo}: ${r.status}`);
