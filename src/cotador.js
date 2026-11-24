// Cliente do MCP oficial do Cotador Simplificado (somente leitura).
// Usa o refresh token gravado no Supabase pela função cotador-auth.

import { MCP_BASE, MCP_URL, PAUSA_MS } from './config.js';
import { db } from './db.js';
import { tempoAcabou, msRestantes } from './util.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Uma conta do Cotador (uma linha em oauth_state: 'cotador', 'cotador2', 'cotador3'...).
class Conta {
  constructor(id) {
    this.id = id;
    this.nome = id;
    this.sessao = null;
    this.token = null;
    this.idSeq = 1;
    this.chamadas = 0;
    this.ultimaChamada = 0;
    this.pausaAte = 0;
    this.nivel = 0; // pausas por limite seguidas (cresce a espera)
    this.renovando = null;
    this.errosSeguidos = 0;
    this.pausasPorLimite = 0;
    this.ocupada = false;
    this.morta = null; // motivo, se o acesso caiu
  }

  // ---------- autenticação ----------
  // Uma renovação por vez: o cotador troca o refresh token a cada uso, e duas renovações
  // simultâneas com o mesmo token fazem ele revogar o acesso (invalid_grant).
  carregarToken(forcarRenovacao = false) {
    if (this.renovando) return this.renovando;
    this.renovando = this._carregarToken(forcarRenovacao).finally(() => { this.renovando = null; });
    return this.renovando;
  }

  async _carregarToken(forcarRenovacao = false) {
    const { data: st, error } = await db.from('oauth_state').select('*').eq('id', this.id).single();
    if (error || !st?.refresh_token) {
      throw new Error(`Monitor sem login no Cotador (${this.id}). Abra o link de login (cotador-auth) e autorize.`);
    }
    const valido = st.access_token && st.expires_at && new Date(st.expires_at).getTime() - Date.now() > 5 * 60 * 1000;
    if (valido && !forcarRenovacao) { this.token = st.access_token; return; }

    const body = new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: st.refresh_token,
      client_id: st.client_id, resource: MCP_URL,
    });
    const headers = { 'content-type': 'application/x-www-form-urlencoded' };
    if (st.client_secret) headers.authorization = 'Basic ' + Buffer.from(`${st.client_id}:${st.client_secret}`).toString('base64');
    const r = await fetch(MCP_BASE + '/token', { method: 'POST', headers, body });
    const tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.access_token) {
      throw new Error(`Cotador recusou a renovação do acesso de ${this.nome} (${r.status} ${tok.error || ''}). Refaça o login pelo link cotador-auth.`);
    }
    await db.from('oauth_state').update({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || st.refresh_token, // o servidor pode girar o refresh token
      expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', this.id);
    this.token = tok.access_token;
  }

  // ---------- transporte MCP (Streamable HTTP) ----------
  async rpc(method, params, { notificacao = false, tentativa = 0 } = {}) {
    if (this.renovando) await this.renovando;
    const tokenUsado = this.token;
    const msg = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
    if (!notificacao) msg.id = this.idSeq++;
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${tokenUsado}`,
      'mcp-protocol-version': '2025-06-18',
    };
    if (this.sessao) headers['mcp-session-id'] = this.sessao;

    let r;
    try {
      r = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(msg), signal: AbortSignal.timeout(90_000) });
    } catch (e) {
      if (tentativa < 4) { await sleep(2000 * 2 ** tentativa); return this.rpc(method, params, { notificacao, tentativa: tentativa + 1 }); }
      throw e;
    }

    if (r.status === 401 && tentativa < 1) {
      // Se outra consulta já renovou enquanto esta estava em andamento, só repete com o token novo.
      if (this.token === tokenUsado) await this.carregarToken(true);
      else if (this.renovando) await this.renovando;
      return this.rpc(method, params, { notificacao, tentativa: tentativa + 1 });
    }
    if (r.status === 404 && this.sessao && tentativa < 2) { // sessão expirou
      this.sessao = null; await this.iniciar(false);
      return this.rpc(method, params, { notificacao, tentativa: tentativa + 1 });
    }
    if ((r.status === 429 || r.status >= 500) && tentativa < 6) {
      const espera = Number(r.headers.get('retry-after')) * 1000 || 3000 * 2 ** tentativa;
      await sleep(Math.min(espera, 120_000));
      return this.rpc(method, params, { notificacao, tentativa: tentativa + 1 });
    }
    const sid = r.headers.get('mcp-session-id');
    if (sid) this.sessao = sid;
    if (notificacao) return null;
    if (!r.ok) throw new Error(`MCP ${method} HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);

    const tipo = r.headers.get('content-type') || '';
    let resp;
    if (tipo.includes('text/event-stream')) {
      const texto = await r.text();
      for (const bloco of texto.split(/\n\n/)) {
        const dados = bloco.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (!dados) continue;
        const j = JSON.parse(dados);
        if (j.id === msg.id) { resp = j; break; }
      }
    } else {
      resp = await r.json();
    }
    if (!resp) throw new Error(`MCP ${method}: resposta vazia`);
    if (resp.error) throw new Error(`MCP ${method}: ${resp.error.message}`);
    return resp.result;
  }

  async iniciar(listar = true) {
    if (!this.token) await this.carregarToken();
    await this.rpc('initialize', {
      protocolVersion: '2025-06-18', capabilities: {},
      clientInfo: { name: 'monitor-tabelas', version: '1.0.0' },
    });
    await this.rpc('notifications/initialized', null, { notificacao: true });
    const ferramentas = new Map();
    if (listar) {
      let cursor;
      do {
        const res = await this.rpc('tools/list', cursor ? { cursor } : {});
        for (const t of res.tools || []) ferramentas.set(norm(t.name), t.name);
        cursor = res.nextCursor;
      } while (cursor);
    }
    return ferramentas;
  }

  // Momento a partir do qual esta conta pode fazer a próxima consulta.
  prontaEm() { return Math.max(this.pausaAte, this.ultimaChamada + PAUSA_MS); }

  // Uma tentativa (respeitando o ritmo da conta). Não lança erro do cotador: devolve o que houve.
  async tentar(real, args) {
    const espera = this.prontaEm() - Date.now();
    if (espera > 0) await sleep(Math.min(espera, Math.max(0, msRestantes())));
    if (tempoAcabou()) return { ok: false, fim: true };
    this.ultimaChamada = Date.now();
    this.chamadas++;
    let msg;
    try {
      const res = await this.rpc('tools/call', { name: real, arguments: args });
      if (!res.isError) { this.errosSeguidos = 0; this.nivel = 0; return { ok: true, dados: extrairDados(res) }; }
      msg = textoDe(res);
    } catch (e) {
      msg = e.message;
      if (/recusou a renovação|sem login/i.test(msg)) { this.morta = msg; return { ok: false, msg, morta: true }; }
    }
    this.errosSeguidos++;
    // Muitos erros seguidos = provável limite, mesmo sem mensagem clara.
    const limite = this.errosSeguidos >= 3 || /limit|muitas|excedi|aguarde|tente (novamente|mais tarde)|rate|too many|throttl|bloquead|quota|cota/i.test(msg);
    const transitorio = limite || /timeout|tempo esgotado|indispon|unavailable|502|503|504|ECONN|fetch failed|aborted/i.test(msg);
    if (limite) {
      const pedido = msg.match(/(\d+)\s*(segundo|second|s\b)/i)?.[1] * 1000 || msg.match(/(\d+)\s*(minuto|minute|min\b)/i)?.[1] * 60000;
      const pausa = Math.min(pedido || 30_000 * 2 ** this.nivel, 15 * 60_000);
      this.nivel++;
      this.pausasPorLimite++;
      this.pausaAte = Math.max(this.pausaAte, Date.now() + pausa);
      console.log(`[cotador] ${this.nome}: limite atingido (${this.pausasPorLimite}ª vez, ${this.chamadas} chamadas); pausando ${Math.round(pausa / 1000)}s`);
    }
    return { ok: false, msg, limite, transitorio };
  }
}

// Conjunto de contas: cada consulta vai para a conta livre que puder responder primeiro.
// Consultas de "área" (quais tabelas aparecem em cada cidade) ficam sempre na conta principal,
// porque contas diferentes podem enxergar tabelas diferentes.
export class Cotador {
  constructor() {
    this.contas = [];
    this.principal = null;
    this.ferramentas = new Map(); // nome normalizado -> nome real
    this.erros = 0;
    this.mensagensErro = new Map();
    this.esperando = [];
  }

  get chamadas() { return this.contas.reduce((s, c) => s + c.chamadas, 0); }
  get pausasPorLimite() { return this.contas.reduce((s, c) => s + c.pausasPorLimite, 0); }
  get vivas() { return this.contas.filter((c) => !c.morta); }

  async iniciar() {
    const { data, error } = await db.from('oauth_state').select('id,conta_nome,refresh_token').like('id', 'cotador%').order('id');
    if (error) throw new Error('Supabase: ' + error.message);
    const ids = (data || []).filter((r) => r.refresh_token).map((r) => r.id);
    if (!ids.length) throw new Error('Monitor sem login no Cotador. Abra o link de login (cotador-auth) e autorize.');
    let primeiroErro;
    for (const id of ids) {
      const c = new Conta(id);
      c.nome = (data.find((r) => r.id === id)?.conta_nome) || id;
      try {
        const f = await c.iniciar(!this.ferramentas.size);
        if (f.size) this.ferramentas = f;
        this.contas.push(c);
      } catch (e) {
        primeiroErro ||= e;
        console.log(`[cotador] conta ${c.nome} indisponível: ${e.message.slice(0, 200)}`);
        this.registrarErro('login', `${c.nome}: ${e.message}`);
      }
    }
    if (!this.contas.length) throw primeiroErro;
    this.principal = this.contas.find((c) => c.id === 'cotador') || this.contas[0];
    // nome de cada conta (para o painel e para os logs)
    for (const c of this.contas) {
      const r = await c.tentar(this.ferramentas.get(norm('contexto.quem-sou')), {}).catch(() => null);
      const nome = r?.ok && r.dados?.nome;
      if (nome) { c.nome = nome; await db.from('oauth_state').update({ conta_nome: nome }).eq('id', c.id); }
    }
    console.log(`[cotador] contas ativas: ${this.contas.map((c) => c.nome).join(', ')}`);
  }

  // Reserva uma conta livre; espera se todas estiverem ocupadas ou pausadas.
  async pegarConta(fixa) {
    for (;;) {
      const candidatas = (fixa ? [this.principal] : this.contas).filter((c) => !c.morta);
      if (!candidatas.length) throw new Error(fixa ? `Conta principal fora do ar: ${this.principal.morta}` : `Todas as contas do Cotador caíram: ${this.contas[0]?.morta}`);
      const livres = candidatas.filter((c) => !c.ocupada).sort((a, b) => a.prontaEm() - b.prontaEm());
      const melhor = livres[0];
      const agora = Date.now();
      // Pega a livre se já pode consultar (ou quase), ou se não há outra para esperar.
      if (melhor && (melhor.prontaEm() - agora < 5000 || livres.length === candidatas.length)) {
        melhor.ocupada = true;
        return melhor;
      }
      if (tempoAcabou()) throw new Error('tempo da execução esgotado');
      const ate = melhor ? Math.min(melhor.prontaEm() - agora, msRestantes()) : msRestantes();
      await new Promise((r) => { const t = setTimeout(r, Math.max(50, ate)); this.esperando.push(() => { clearTimeout(t); r(); }); });
    }
  }

  liberar(c) {
    c.ocupada = false;
    const w = this.esperando; this.esperando = [];
    for (const r of w) r();
  }

  // ---------- chamada de ferramenta ----------
  async ferramenta(nome, args, { fixa = false } = {}) {
    try {
      const real = this.ferramentas.get(norm(nome));
      if (!real) throw new Error(`Ferramenta ${nome} não existe no MCP do cotador`);
      let limites = 0, falhas = 0;
      for (;;) {
        // Não começa consulta nova depois do tempo da execução: o ponto é salvo e a próxima continua.
        if (tempoAcabou()) throw new Error('tempo da execução esgotado');
        const conta = await this.pegarConta(fixa);
        let r;
        try { r = await conta.tentar(real, args); } finally { this.liberar(conta); }
        if (r.ok) return r.dados;
        if (r.fim) throw new Error('tempo da execução esgotado');
        this.registrarErro(nome, r.morta ? `${conta.nome}: ${r.msg}` : r.msg);
        if (r.morta) { console.log(`[cotador] ${conta.nome} saiu do ar: ${r.msg.slice(0, 200)}`); continue; }
        if (r.limite) { if (++limites >= 8 * this.vivas.length) throw new Error(`${nome}: ${r.msg.slice(0, 300)}`); continue; }
        falhas++;
        if ((!r.transitorio && falhas > 3) || falhas > 8) throw new Error(`${nome}: ${r.msg.slice(0, 300)}`);
        await sleep(Math.min(3000 * 2 ** falhas, 60_000, Math.max(0, msRestantes())));
      }
    } catch (e) {
      this.erros++;
      throw e;
    }
  }

  registrarErro(nome, msg) {
    const k = `${nome}: ${String(msg).slice(0, 160)}`;
    this.mensagensErro.set(k, (this.mensagensErro.get(k) || 0) + 1);
    if (this.mensagensErro.get(k) === 1 && this.mensagensErro.size <= 15) console.log('[cotador] erro:', k);
  }

  resumoErros() {
    return [...this.mensagensErro.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, n]) => `${n}× ${m}`);
  }

  resumoContas() {
    return this.contas.map((c) => ({ conta: c.nome, chamadas: c.chamadas, pausasPorLimite: c.pausasPorLimite, ...(c.morta ? { caiu: c.morta.slice(0, 150) } : {}) }));
  }

  // atalhos
  buscarCidade(uf, nome) { return this.ferramenta('cotacao.buscar-cidade', { uf, nome, limite: 20 }, { fixa: true }); }

  async listarTabelas(ufId, cidadeId, tipoTabela) {
    const itens = [];
    for (let desloc = 0; ; desloc += 50) {
      const d = await this.ferramenta('cotacao.listar-tabelas', { ufId, cidadeId, tipoTabela, limite: 50, deslocamento: desloc }, { fixa: true });
      itens.push(...(d?.itens || []));
      if (!d?.truncado || !d?.itens?.length) break;
    }
    return itens;
  }

  async opcoesPreco(ufId, tipoTabela, planosIds, idade, vidas = 1) {
    const itens = [];
    for (let desloc = 0; ; desloc += 100) {
      const d = await this.ferramenta('cotacao.listar-opcoes-preco', {
        ufId, tipoTabela, planosIds, idades: [{ idade, vidas }], limite: 100, deslocamento: desloc,
      });
      itens.push(...(d?.itens || []));
      if (!d?.truncado || !d?.itens?.length) break;
    }
    return itens;
  }

  coparticipacao(produtos) { return this.ferramenta('cotacao.coparticipacao-vigente', { produtos }); }
  carencia(produtos) { return this.ferramenta('cotacao.carencia-vigente', { produtos }); }
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const textoDe = (res) => (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');

// As respostas vêm como {aviso, nonce, dados:{...}} em texto JSON (ou structuredContent).
function extrairDados(res) {
  let obj = res.structuredContent;
  if (!obj) {
    const t = textoDe(res);
    try { obj = JSON.parse(t); } catch { return { texto: t }; }
  }
  return obj && 'dados' in obj ? obj.dados : obj;
}
