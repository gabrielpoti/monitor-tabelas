import { TELEGRAM_TOKEN, TELEGRAM_CHAT, SITE_URL } from './config.js';

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export async function enviar(texto) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) { console.log('[telegram desativado]\n' + texto); return; }
  // Telegram aceita até 4096 caracteres por mensagem.
  const partes = [];
  let atual = '';
  for (const linha of texto.split('\n')) {
    if ((atual + linha).length > 3800) { partes.push(atual); atual = ''; }
    atual += linha + '\n';
  }
  if (atual.trim()) partes.push(atual);
  for (const p of partes) {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text: p, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!r.ok) console.error('Telegram falhou:', r.status, await r.text());
  }
}

const ROTULOS = {
  preco: '💲 Preço', novo_preco_agendado: '📅 Preço novo agendado', desconto: '🏷️ Desconto', encerrada: '⛔ Encerrada',
  combinacao_removida: '➖ Combinação removida', coparticipacao: '🧾 Coparticipação', carencia: '⏳ Carência',
  tabela_nova: '🆕 Tabela nova', tabela_removida: '🗑️ Tabela removida', tabela_voltou: '↩️ Tabela voltou', planos: '📋 Planos',
  area_entrou: '📍 Área (entrou)', area_saiu: '📍 Área (saiu)', rede: '🏥 Rede',
};

export function montarRelatorio(modo, mudancas, resumo) {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  let t = `<b>Monitor de Tabelas — ${modo} ${data}</b>\n`;
  if (!mudancas.length) {
    t += '\nNenhuma mudança encontrada nas operadoras monitoradas. ✅\n';
  } else {
    t += `${mudancas.length} mudança(s):\n`;
    const porOp = new Map();
    for (const m of mudancas) { const k = m.operadora || 'Outras'; if (!porOp.has(k)) porOp.set(k, []); porOp.get(k).push(m); }
    for (const [op, ms] of [...porOp].sort((a, b) => b[1].length - a[1].length)) {
      t += `\n<b>${esc(op)}</b> (${ms.length})\n`;
      for (const m of ms.slice(0, 25)) t += `• ${ROTULOS[m.tipo] || m.tipo}: ${esc(m.descricao)}\n`;
      if (ms.length > 25) t += `• … e mais ${ms.length - 25} (ver tabela "mudancas" no Supabase)\n`;
    }
  }
  if (resumo) t += `\n<i>${esc(resumo)}</i>`;
  if (SITE_URL && mudancas.length) t += `\n\n<a href="${SITE_URL}/alteracoes">Ver alterações no site</a>`;
  return t;
}
