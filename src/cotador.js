// Cliente do MCP oficial do Cotador Simplificado (somente leitura).
// Usa o refresh token gravado no Supabase pela função cotador-auth.

import { MCP_BASE, MCP_URL, CONCORRENCIA, PAUSA_MS } from './config.js';
import { db } from './db.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cotador {
  constructor() {
    this.sessao = null;
    this.token = null;
    this.ferramentas = new Map(); // nome normalizado -> nome real
    this.idSeq = 1;
    this.chamadas = 0;
    this.erros = 0;
    this.fila = [];
    this.ativas = 0;
    this.ultimaChamada = 0;
  }

  // ---------- autenticação ----------
  async carregarToken(forcarRenovacao = false) {
    const { data: st, error } = await db.from('oauth_state').select('*').eq('id', 'cotador').single();
    if (error || !st?.refresh_token) {
      throw new Error('Monitor sem login no Cotador. Abra o link de login (cotador-auth) e autorize.');
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
      throw new Error(`Cotador recusou a renovação do acesso (${r.status} ${tok.error || ''}). Refaça o login pelo link cotador-auth.`);
    }
    await db.from('oauth_state').update({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || st.refresh_token, // o servidor pode girar o refresh token
      expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', 'cotador');
    this.token = tok.access_token;
  }

  // ---------- transporte MCP (Streamable HTTP) ----------
  async rpc(method, params, { notificacao = false, tentativa = 0 } = {}) {
    const msg = { jsonrpc: '2.0', method, ...(params ? { params } : {}) };
    if (!notificacao) msg.id = this.idSeq++;
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${this.token}`,
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
      await this.carregarToken(true);
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
    if (listar) {
      let cursor;
      do {
        const res = await this.rpc('tools/list', cursor ? { cursor } : {});
        for (const t of res.tools || []) this.ferramentas.set(norm(t.name), t.name);
        cursor = res.nextCursor;
      } while (cursor);
    }
  }

  // ---------- chamada de ferramenta, com fila e limite de concorrência ----------
  async ferramenta(nome, args) {
    await this.vaga();
    try {
      const real = this.ferramentas.get(norm(nome));
      if (!real) throw new Error(`Ferramenta ${nome} não existe no MCP do cotador`);
      const espera = this.ultimaChamada + PAUSA_MS - Date.now();
      if (espera > 0) await sleep(espera);
      this.ultimaChamada = Date.now();
      this.chamadas++;
      const res = await this.rpc('tools/call', { name: real, arguments: args });
      if (res.isError) throw new Error(`${nome}: ${textoDe(res).slice(0, 300)}`);
      return extrairDados(res);
    } catch (e) {
      this.erros++;
      throw e;
    } finally {
      this.ativas--;
      const prox = this.fila.shift();
      if (prox) prox();
    }
  }

  vaga() {
    if (this.ativas < CONCORRENCIA) { this.ativas++; return Promise.resolve(); }
    return new Promise((res) => this.fila.push(() => { this.ativas++; res(); }));
  }

  // atalhos
  buscarCidade(uf, nome) { return this.ferramenta('cotacao.buscar-cidade', { uf, nome, limite: 20 }); }

  async listarTabelas(ufId, cidadeId, tipoTabela) {
    const itens = [];
    for (let desloc = 0; ; desloc += 50) {
      const d = await this.ferramenta('cotacao.listar-tabelas', { ufId, cidadeId, tipoTabela, limite: 50, deslocamento: desloc });
      itens.push(...(d?.itens || []));
      if (!d?.truncado || !d?.itens?.length) break;
    }
    return itens;
  }

  async opcoesPreco(ufId, tipoTabela, planosIds, idade) {
    const itens = [];
    for (let desloc = 0; ; desloc += 100) {
      const d = await this.ferramenta('cotacao.listar-opcoes-preco', {
        ufId, tipoTabela, planosIds, idades: [{ idade, vidas: 1 }], limite: 100, deslocamento: desloc,
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
