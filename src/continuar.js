// Roda no fim de cada execução do monitor: se há uma prioridade com rede pendente e nada mais na fila,
// dispara a continuação. Se houver outra execução na fila (ex.: o diário), não dispara — ela mesma, ao
// terminar, passa por aqui e dispara a continuação. Assim a prioridade nunca derruba o diário da fila.
import { getConfig, setConfig } from './db.js';

// 1º: execuções regulares que ficaram esperando (diário, descontos, rede, semanal); 2º: prioridade pendente.
let filaExec = []; try { filaExec = JSON.parse((await getConfig('fila_execucoes')) || '[]'); } catch {}
const valor = await getConfig('prioridade_pendente');
let fila; try { fila = JSON.parse(valor); } catch { fila = valor; }
const grupo = Array.isArray(fila) ? fila[0] : fila;
if (!grupo && !filaExec.length) { console.log('Nada pendente.'); process.exit(0); }
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
const api = (p, init = {}) => fetch(`https://api.github.com/repos/${repo}${p}`, {
  ...init, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', ...(init.headers || {}) },
});
for (const status of ['queued', 'pending', 'waiting']) {
  const j = await (await api(`/actions/workflows/monitor.yml/runs?status=${status}&per_page=5`)).json();
  if ((j.total_count || 0) > 0) { console.log(`Já há execução na fila (${status}); ela continua a prioridade de ${grupo} depois.`); process.exit(0); }
}
if (filaExec.length) {
  const prox = filaExec.shift();
  const r = await api('/actions/workflows/monitor.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { modo: prox.modo, grupo: prox.grupo || '' } }) });
  if (r.ok) await setConfig('fila_execucoes', filaExec.length ? JSON.stringify(filaExec) : null);
  console.log(`Execução da fila (${prox.modo}): ${r.status}`);
} else {
  const r = await api('/actions/workflows/monitor.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { modo: 'prioridade', grupo } }) });
  console.log(`Continuação da prioridade ${grupo}: ${r.status}`);
}
