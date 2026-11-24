// =====================================================================
// Extrator de tabelas – Painel do Corretor → uma planilha Excel por operadora
// Operadoras: Hapvida, NotreDame, Unimed, Bradesco, SulAmérica e Porto Seguro (+ Portomed),
//             diretas e por administradoras, PF / PME / Adesão, todo o Brasil.
//
// Como usar (no computador):
//   1. Entre em https://beta.paineldocorretor.com.br (qualquer tela).
//   2. F12 → aba "Console" (se o Chrome pedir, digite: allow pasting).
//   3. Cole TODO este código e aperte Enter.
//   4. Na janela que abrir, escolha o que extrair e clique em "Começar".
//   5. Deixe a aba aberta. Se fechar ou travar, abra o Painel, cole o código de novo
//      e clique em "Continuar": ele retoma de onde parou.
//   Ao terminar, baixa uma planilha .xlsx por operadora (o Chrome pode pedir para
//   permitir vários downloads: clique em Permitir).
//
// O script cria cotações "EXTRAÇÃO 10 vidas" (e 30/100/300 vidas, se precisar) para ler
// os preços: coloca um plano, lê e tira. Não mexa nelas enquanto ele roda.
// Para parar no meio: clique em "Parar" no quadro do canto da tela.
// =====================================================================

(async () => {
  if (window.__extrator?.rodando) { alert('O extrator já está rodando nesta aba.'); return; }
  const E = (window.__extrator = { rodando: true, parar: false });

  // ---------------- constantes ----------------
  const OPERADORAS = ['Hapvida', 'NotreDame', 'Unimed', 'Bradesco', 'SulAmérica', 'Porto Seguro'];
  const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
  const PRINCIPAIS = { SP: ['São Paulo','Guarulhos','Osasco','Santo André','São Bernardo do Campo','Mogi das Cruzes','Barueri','Campinas','Jundiaí','Piracicaba','Americana','Limeira','Santos','Praia Grande','Registro','Ribeirão Preto','Franca','São Carlos','Araraquara','São José dos Campos','Taubaté','Sorocaba','Itu','Bauru','Marília','Botucatu','São José do Rio Preto','Araçatuba','Presidente Prudente','Bragança Paulista','Atibaia'],
    RJ: ['Rio de Janeiro','Niterói','São Gonçalo','Duque de Caxias','Nova Iguaçu','Petrópolis','Teresópolis','Volta Redonda','Resende','Macaé','Campos dos Goytacazes','Cabo Frio'],
    CE: ['Fortaleza','Caucaia','Maracanaú','Juazeiro do Norte','Sobral','Crato','Itapipoca','Maranguape','Iguatu','Quixadá'],
    DF: ['Brasília'], AC: ['Rio Branco'], AL: ['Maceió','Arapiraca'], AM: ['Manaus'], AP: ['Macapá'], BA: ['Salvador','Feira de Santana','Vitória da Conquista','Camaçari','Juazeiro','Ilhéus','Itabuna'],
    ES: ['Vitória','Vila Velha','Serra','Cariacica'], GO: ['Goiânia','Anápolis','Aparecida de Goiânia','Rio Verde'], MA: ['São Luís','Imperatriz'], MG: ['Belo Horizonte','Uberlândia','Juiz de Fora','Contagem','Montes Claros','Uberaba','Ipatinga'],
    MS: ['Campo Grande','Dourados'], MT: ['Cuiabá','Várzea Grande','Rondonópolis'], PA: ['Belém','Ananindeua','Santarém','Marabá'], PB: ['João Pessoa','Campina Grande'], PE: ['Recife','Jaboatão dos Guararapes','Olinda','Caruaru','Petrolina'],
    PI: ['Teresina','Parnaíba'], PR: ['Curitiba','Londrina','Maringá','Ponta Grossa','Cascavel','Foz do Iguaçu'], RN: ['Natal','Mossoró'], RO: ['Porto Velho','Ji-Paraná'], RR: ['Boa Vista'],
    RS: ['Porto Alegre','Caxias do Sul','Pelotas','Canoas','Santa Maria','Passo Fundo'], SC: ['Florianópolis','Joinville','Blumenau','Chapecó','Itajaí','Criciúma'], SE: ['Aracaju'], TO: ['Palmas','Araguaína'] };
  const FAIXAS = ['00-18','19-23','24-28','29-33','34-38','39-43','44-48','49-53','54-58','59-199'];
  const FAIXAS_TXT = ['0-18 anos','19-23 anos','24-28 anos','29-33 anos','34-38 anos','39-43 anos','44-48 anos','49-53 anos','54-58 anos','59+ anos'];
  const MODS = { 1: 'PF', 2: 'PME', 3: 'Adesão' };
  // buscas por cidade: o Painel só lista as tabelas que aceitam a quantidade de vidas informada
  const BUSCAS = [{ mod: 1, q: 1 }, { mod: 3, q: 1 }, { mod: 2, q: 1 }, { mod: 2, q: 3 }, { mod: 2, q: 10 }, { mod: 2, q: 30 }];
  const ACOES_PADRAO = { searchCenarios: '40e88732d3425dd41ab1af2ff3d5829fec0d4d259e', onPlanoSelect: '6049417af772e9619d0431f15206cd0709d2e81ba3',
    removerCenario: '604c6c4f79084bd6bbb37ccd24e2856151348b30b3', addGrupo: '7f6e1bbb7f685ae44c9227c1bbd4620178506ab967', create: '408f00e7cc28c04ac1d2508f4d1e1da9d1d976f872', rede: '785de21ba826159c32832c37f10155b64e1b96e2c5' };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const semAcento = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const agora = () => new Date().toLocaleString('pt-BR');

  const grupoDe = (c) => {
    const o = semAcento(c.operadora?.nome), p = semAcento(c.produto?.nome);
    if (/unimed/.test(o)) return 'Unimed';
    if (/bradesco/.test(o)) return 'Bradesco';
    if (/sul ?america/.test(o)) return 'SulAmérica';
    if (/porto ?(seguro|saude)|portomed/.test(o)) return 'Porto Seguro';
    const nd = /notre ?dame|gndi|intermedica/;
    if (nd.test(p)) return 'NotreDame';
    if (/hapvida/.test(o)) return nd.test(o) && !/hapvida/.test(p) ? 'NotreDame' : 'Hapvida';
    if (nd.test(o)) return 'NotreDame';
    return null;
  };

  // ---------------- armazenamento (para continuar depois) ----------------
  const db = await new Promise((ok, erro) => {
    const r = indexedDB.open('extrator-painel', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
  });
  const kv = (modo, fn) => new Promise((ok, erro) => { const t = db.transaction('kv', modo); const req = fn(t.objectStore('kv')); t.oncomplete = () => ok(req?.result); t.onerror = () => erro(t.error); });
  const ler = (k) => kv('readonly', (s) => s.get(k));
  const gravar = (k, v) => kv('readwrite', (s) => s.put(v, k));
  const lerPrefixo = async (p) => { const out = {}; await kv('readonly', (s) => { const req = s.openCursor(IDBKeyRange.bound(p, p + '￿')); req.onsuccess = () => { const c = req.result; if (c) { out[c.key.slice(p.length)] = c.value; c.continue(); } }; return req; }); return out; };
  const limparTudo = () => kv('readwrite', (s) => s.clear());

  // ---------------- quadro de andamento ----------------
  const painel = document.createElement('div');
  painel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#0f1b2b;color:#fff;font:13px system-ui;padding:12px 14px;border-radius:10px;box-shadow:0 6px 24px #0008;max-width:380px;white-space:pre-wrap';
  const txt = document.createElement('div'); txt.textContent = 'Extrator de tabelas';
  const bParar = document.createElement('button'); bParar.textContent = 'Parar'; bParar.style.cssText = 'margin-top:8px;padding:4px 10px;border-radius:6px;border:0;cursor:pointer';
  bParar.onclick = () => { E.parar = true; bParar.disabled = true; bParar.textContent = 'Parando…'; };
  painel.append(txt, bParar); document.body.append(painel);
  const status = (s) => { txt.textContent = s; console.log('[extrator] ' + s); };
  const fechar = () => { E.rodando = false; setTimeout(() => painel.remove(), 60000); };

  // ---------------- janela de escolha ----------------
  const salvo = await ler('estado');
  const escolha = await new Promise((resolve) => {
    const fundo = document.createElement('div');
    fundo.style.cssText = 'position:fixed;inset:0;background:#0009;z-index:2147483647;display:flex;align-items:center;justify-content:center;font:14px system-ui';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;color:#1d2733;border-radius:12px;padding:20px 22px;width:min(640px,94vw);max-height:90vh;overflow:auto';
    const chk = (nome, valor, marcado, rotulo) => `<label style="display:inline-flex;gap:6px;align-items:center;margin:3px 12px 3px 0"><input type="checkbox" name="${nome}" value="${valor}" ${marcado ? 'checked' : ''}>${rotulo || valor}</label>`;
    const cont = salvo && !salvo.concluido ? `<div style="background:#fff7e6;border:1px solid #f0c36d;border-radius:8px;padding:10px;margin-bottom:12px">Existe uma extração parada (iniciada em ${salvo.inicio}, fase: ${salvo.fase}).<br><button id="xContinuar" style="margin-top:8px;padding:6px 12px;border-radius:6px;border:0;background:#1F4E78;color:#fff;cursor:pointer">Continuar essa extração</button></div>` : '';
    box.innerHTML = `<h2 style="margin:0 0 4px;font-size:18px;color:#1F4E78">O que extrair?</h2>
      <p style="margin:0 0 12px;color:#5b6878">Preços por faixa sempre entram. Uma planilha por operadora.</p>${cont}
      <b>Operadoras</b><div>${OPERADORAS.map((o) => chk('op', o, true)).join('')}</div>
      <b style="display:block;margin-top:10px">Além dos preços</b><div>${chk('sec', 'area', false, 'Área de comercialização')}${chk('sec', 'regras', false, 'Regras (coparticipação, regras gerais, taxas, vigência…)')}${chk('sec', 'carencia', false, 'Carências')}${chk('sec', 'rede', false, 'Rede credenciada (demora bem mais)')}</div>
      <b style="display:block;margin-top:10px">Modalidades</b><div>${chk('mod', '1', true, 'PF')}${chk('mod', '2', true, 'PME')}${chk('mod', '3', true, 'Adesão')}</div>
      <b style="display:block;margin-top:10px">Estados</b>
      <div style="margin:4px 0"><button type="button" id="xTodos">Todo o Brasil</button> <button type="button" id="xNossos">CE, SP e RJ</button> <button type="button" id="xNenhum">Nenhum</button></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(58px,1fr))">${UFS.map((u) => chk('uf', u, true)).join('')}</div>
      <b style="display:block;margin-top:10px">Cidades</b>
      <div><label style="margin-right:14px"><input type="radio" name="cid" value="todas" checked> Todas as cidades (completo, demora mais)</label><label><input type="radio" name="cid" value="principais"> Só capitais e polos (rápido, pode perder tabelas regionais)</label></div>
      <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end"><button id="xCancelar" style="padding:8px 14px;border-radius:6px;border:1px solid #c7d0db;background:#fff;cursor:pointer">Cancelar</button><button id="xComecar" style="padding:8px 14px;border-radius:6px;border:0;background:#1F4E78;color:#fff;cursor:pointer">Começar nova extração</button></div>`;
    fundo.append(box); document.body.append(fundo);
    const q = (s) => box.querySelector(s), todos = (n) => [...box.querySelectorAll(`input[name=${n}]`)];
    q('#xTodos').onclick = () => todos('uf').forEach((c) => (c.checked = true));
    q('#xNenhum').onclick = () => todos('uf').forEach((c) => (c.checked = false));
    q('#xNossos').onclick = () => todos('uf').forEach((c) => (c.checked = ['CE', 'SP', 'RJ'].includes(c.value)));
    q('#xCancelar').onclick = () => { fundo.remove(); resolve(null); };
    if (q('#xContinuar')) q('#xContinuar').onclick = () => { fundo.remove(); resolve({ continuar: true }); };
    q('#xComecar').onclick = () => {
      const val = (n) => todos(n).filter((c) => c.checked).map((c) => c.value);
      const cfg = { ops: val('op'), secoes: val('sec'), mods: val('mod').map(Number), ufs: val('uf'), cidades: box.querySelector('input[name=cid]:checked').value };
      if (!cfg.ops.length || !cfg.ufs.length || !cfg.mods.length) { alert('Marque ao menos uma operadora, uma modalidade e um estado.'); return; }
      fundo.remove(); resolve({ cfg });
    };
  });
  if (!escolha) { painel.remove(); E.rodando = false; return; }

  let S;
  if (escolha.continuar) S = salvo;
  else {
    await limparTudo();
    S = { inicio: agora(), cfg: escolha.cfg, fase: 'listando', ui: 0, ci: 0, pos: 0, redePos: 0, cotacoes: {}, erros: [], concluido: false };
    await gravar('estado', S);
  }
  const C = S.cfg;
  const salvarEstado = () => gravar('estado', S);
  const erro = (m) => { S.erros.push(`${agora()} ${m}`); if (S.erros.length > 3000) S.erros.splice(0, 1000); };

  // ---------------- ações do Painel ----------------
  let ACOES = { ...ACOES_PADRAO, ...((await ler('acoes')) || {}) };
  const descobrir = async (path) => {
    try {
      const t = await (await fetch(path)).text();
      const chunks = [...new Set([...t.matchAll(/static\/chunks\/[^"'\\ ]+?\.js/g)].map((m) => m[0]))];
      const achou = {};
      for (const c of chunks) { try { const js = await (await fetch('/_next/' + c)).text(); for (const m of js.matchAll(/"([0-9a-f]{42})",[^"]{0,80}"([A-Za-z_$][\w$]*)"\)/g)) achou[m[2]] = m[1]; } catch (e) {} }
      for (const k of ['searchCenarios', 'onPlanoSelect', 'removerCenario', 'addGrupo', 'create']) if (achou[k]) ACOES[k] = achou[k];
      ACOES._nomes = [...new Set([...(ACOES._nomes || []), ...Object.keys(achou)])];
      const rede = Object.keys(achou).find((k) => /credenciad|rede/i.test(k) && !/cotacao/i.test(k));
      if (rede) ACOES.rede = achou[rede];
      await gravar('acoes', ACOES);
    } catch (e) {}
  };
  class Parada extends Error {}
  const acao = async (nome, path, args, bruto = false) => {
    for (let t = 0; t < 5; t++) {
      if (E.parar) throw new Parada();
      try {
        const r = await fetch(path, { method: 'POST', headers: { 'Accept': 'text/x-component', 'next-action': ACOES[nome], 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(args) });
        const t2 = await r.text();
        if (r.status === 429 || r.status === 403) { status(`O Painel recusou consultas (${r.status}). Esperando 2 min…`); await sleep(120000); continue; }
        if (r.ok && (r.headers.get('content-type') || '').includes('x-component')) {
          if (bruto) return t2;
          const l = t2.split('\n').find((x) => x.startsWith('1:')) || '';
          if (l.startsWith('1:E')) throw new Error('falha do Painel');
          try { return JSON.parse(l.slice(2)); } catch (e) { return null; }
        }
        if (r.status === 404 || /server action/i.test(t2.slice(0, 500))) await descobrir(path);
      } catch (e) { if (e instanceof Parada) throw e; }
      await sleep(2000 * (t + 1));
    }
    return null;
  };

  // cotações de leitura (uma por quantidade de vidas por faixa)
  const cotacaoPara = async (q) => {
    if (S.cotacoes[q]) return S.cotacoes[q];
    const titulo = `EXTRAÇÃO ${q * 10} vidas`;
    const acharPorTitulo = async () => { const t = await (await fetch('/cotacoes', { headers: { RSC: '1' } })).text(); const i = t.indexOf(titulo); return i < 0 ? null : (t.slice(Math.max(0, i - 800), i).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []).pop() || null; };
    let id = await acharPorTitulo();
    if (!id) {
      await descobrir('/cotacoes/nova');
      await fetch('/cotacoes/nova', { method: 'POST', redirect: 'manual', headers: { 'Accept': 'text/x-component', 'next-action': ACOES.create, 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify([{ titulo }]) });
      await sleep(1500);
      id = await acharPorTitulo();
      if (!id) throw new Error(`Não consegui criar a cotação "${titulo}". Crie manualmente uma cotação com esse nome e rode de novo.`);
      await descobrir(`/cotacoes/${id}/edit`);
      await acao('addGrupo', `/cotacoes/${id}/edit`, [{ cotacaoId: id, nome: 'Geral', vidas: FAIXAS.map((f) => ({ faixa: f, quantidade: q })) }]);
    }
    S.cotacoes[q] = id; await salvarEstado();
    return id;
  };

  // ---------------- leitura da página do plano ----------------
  const lerRSC = (txt) => {
    const b = new TextEncoder().encode(txt), dec = new TextDecoder(), rows = {};
    let p = 0;
    while (p < b.length) {
      let q = p; while (q < b.length && b[q] !== 58) q++;
      const id = dec.decode(b.slice(p, q)); q++;
      if (!/^[0-9a-f]+$/.test(id)) { while (q < b.length && b[q] !== 10) q++; p = q + 1; continue; }
      if (b[q] === 84) { let r = q + 1; while (b[r] !== 44) r++; const n = parseInt(dec.decode(b.slice(q + 1, r)), 16); rows[id] = dec.decode(b.slice(r + 1, r + 1 + n)); p = r + 1 + n; }
      else { let r = q; while (r < b.length && b[r] !== 10) r++; const s = dec.decode(b.slice(q, r)); try { rows[id] = JSON.parse(s); } catch { rows[id] = s; } p = r + 1; }
    }
    return rows;
  };
  const htmlTexto = (html) => {
    const d = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    d.querySelectorAll('br').forEach((e) => e.replaceWith('\n'));
    d.querySelectorAll('td,th').forEach((e) => e.append(' | '));
    d.querySelectorAll('li').forEach((e) => e.prepend('• '));
    d.querySelectorAll('p,li,tr,h1,h2,h3,h4,h5,div').forEach((e) => e.append('\n'));
    return d.body.textContent.replace(/ \| \n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  const querSecoes = C.secoes.some((s) => ['area', 'regras', 'carencia'].includes(s));
  const lerPaginaPlano = (txt) => {
    const precos = {};
    for (const x of txt.matchAll(/"div","(\d\d-\d+)",\{"className":"-mx-6"[\s\S]{0,600}?"R\$\s?","([\d.]*,\d\d)"/g)) {
      const f = x[1] === '59-199' ? '59+' : x[1];
      if (!(f in precos)) precos[f] = Number(x[2].replace(/\./g, '').replace(',', '.'));
    }
    const secoes = {};
    if (querSecoes) {
      const rows = lerRSC(txt), visto = new Set();
      const conteudo = (n, out, prof = 0) => {
        if (prof > 60 || n == null) return;
        if (typeof n === 'string') { const r = n.match(/^\$L?([0-9a-f]+)$/); if (r && rows[r[1]] !== undefined) { if (visto.has(r[1])) return; visto.add(r[1]); const v = rows[r[1]]; typeof v === 'string' ? out.push(v) : conteudo(v, out, prof + 1); return; } if (!n.startsWith('$')) out.push(n); return; }
        if (Array.isArray(n)) { if (n[0] === '$' && typeof n[1] === 'string' && n[1] !== 'svg') { const pr = n[3] || {}; if (pr.dangerouslySetInnerHTML) conteudo(pr.dangerouslySetInnerHTML.__html, out, prof + 1); conteudo(pr.children, out, prof + 1); } else n.forEach((x) => conteudo(x, out, prof + 1)); return; }
        if (typeof n === 'object') conteudo(n.children, out, prof + 1);
      };
      const achar = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) {
          if (n[0] === '$' && n[3] && typeof n[3].tipo === 'string' && !(n[3].children && n[3].children[1] === 'button')) { visto.clear(); const out = []; conteudo(n[3].children, out); const html = out.join('\n').trim(); if (html && html !== n[3].tipo) secoes[n[3].tipo] = htmlTexto(html); return; }
          n.forEach(achar); return;
        }
        Object.values(n).forEach(achar);
      };
      Object.values(rows).forEach((r) => typeof r === 'object' && achar(r));
    }
    return { precos, secoes };
  };

  // =============== FASE 1: listar tabelas e planos ===============
  const cidadesDe = async (uf) => {
    if (C.cidades === 'principais') return PRINCIPAIS[uf] || [];
    const cache = await ler('cidades:' + uf);
    if (cache) return cache;
    for (let t = 0; t < 3; t++) {
      try { const l = (await (await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`)).json()).map((m) => m.nome); if (l.length) { await gravar('cidades:' + uf, l); return l; } } catch (e) {}
      await sleep(3000);
    }
    throw new Error('Não consegui a lista de cidades do IBGE para ' + uf);
  };
  const buscas = BUSCAS.filter((b) => C.mods.includes(b.mod));
  const limpo = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === '$undefined' ? undefined : v)));

  try {
    const cot1 = await cotacaoPara(1);
    const pathBusca = `/cotacoes/${cot1}/edit`;
    if (!escolha.continuar || !(await ler('acoes'))) { status('Preparando (lendo os códigos do Painel)…'); await descobrir(pathBusca); }

    if (S.fase === 'listando') {
      const itens = (await ler('itens')) || {};
      const t0 = Date.now();
      let feitasAgora = 0;
      while (S.ui < C.ufs.length) {
        const uf = C.ufs[S.ui];
        const cidades = await cidadesDe(uf);
        while (S.ci < cidades.length) {
          if (E.parar) throw new Parada();
          const lote = cidades.slice(S.ci, S.ci + 3); // 3 cidades em paralelo
          await Promise.all(lote.map(async (nome) => {
            const cidade = `${nome} - ${uf}`;
            for (const b of buscas) {
              const d = await acao('searchCenarios', pathBusca, [{ cidade, modalidade: b.mod, credenciados: [], perfil: '$undefined', busca: '$undefined', vidas: FAIXAS.map((f) => ({ faixa: f, quantidade: b.q })) }]);
              if (d === null) { erro(`busca falhou: ${cidade} ${MODS[b.mod]} ${b.q * 10} vidas`); continue; }
              for (const x of Array.isArray(d) ? d : []) {
                const g = grupoDe(x);
                if (!g || !C.ops.includes(g)) continue;
                const k = `${x.tabela?.id}|${x.plano?.id}|${x.entidade?.id || ''}|${b.mod}`;
                const it = itens[k] || (itens[k] = { k, g, mod: b.mod, q: b.q, cidade, c: limpo({ ...x, valor: undefined }), ufs: [], n: 0, amostra: [] });
                if (!it.ufs.includes(uf)) it.ufs.push(uf);
                it.n++; if (it.amostra.length < 25) it.amostra.push(cidade);
              }
            }
          }));
          S.ci += lote.length; feitasAgora += lote.length;
          if (feitasAgora % 30 < 3) {
            await gravar('itens', itens); await salvarEstado();
            const ritmo = (Date.now() - t0) / feitasAgora;
            const faltam = cidades.length - S.ci;
            status(`1/3 Listando tabelas – ${uf} (${S.ui + 1}/${C.ufs.length}): ${S.ci}/${cidades.length} cidades\n${Object.keys(itens).length} planos encontrados\n~${Math.round(faltam * ritmo / 60000)} min para terminar ${uf}`);
          }
        }
        S.ui++; S.ci = 0;
        await gravar('itens', itens); await salvarEstado();
      }
      S.fila = Object.keys(itens).sort();
      S.fase = 'planos'; S.pos = 0;
      await salvarEstado();
      status(`1/3 Listagem concluída: ${S.fila.length} planos para abrir.`);
    }

    // =============== FASE 2: abrir cada plano (preços e textos) ===============
    if (S.fase === 'planos') {
      const itens = (await ler('itens')) || {};
      // limpa sobras nas cotações de leitura
      for (const id of Object.values(S.cotacoes)) {
        const t = await (await fetch(`/cotacoes/${id}/edit`, { headers: { RSC: '1' } })).text();
        for (const cid of new Set((t.match(/cenarios\/[0-9a-f-]{36}/g) || []).map((x) => x.split('/')[1]))) await acao('removerCenario', `/cotacoes/${id}/edit`, [id, cid]);
      }
      const t0 = Date.now(), pos0 = S.pos;
      while (S.pos < S.fila.length) {
        if (E.parar) throw new Parada();
        const it = itens[S.fila[S.pos]];
        if (it) {
          try {
            const cot = await cotacaoPara(it.q), path = `/cotacoes/${cot}/edit`;
            const resp = await acao('onPlanoSelect', path, [cot, { cidade: it.cidade, modalidade: it.mod, credenciados: [], ...it.c }], true);
            if (!resp) throw new Error('não adicionou');
            const ids = [...new Set((resp.match(/cenarios\/[0-9a-f-]{36}/g) || []).map((x) => x.split('/')[1]))];
            try {
              if (ids.length !== 1) throw new Error(`cotação com ${ids.length} planos`);
              const pg = await (await fetch(`/cotacoes/${cot}/cenarios/${ids[0]}`, { headers: { RSC: '1' } })).text();
              const r = lerPaginaPlano(pg);
              if (Object.keys(r.precos).length < 10) erro(`preço incompleto (${Object.keys(r.precos).length} faixas): ${it.g} | ${it.c.produto?.nome} | ${it.c.tabela?.nome} | ${it.c.plano?.nome}`);
              await gravar('r:' + it.k, r);
            } finally { for (const id of ids) await acao('removerCenario', path, [cot, id]); }
          } catch (e) {
            if (e instanceof Parada) throw e;
            erro(`${it.g} | ${it.c.produto?.nome} | ${it.c.tabela?.nome} | ${it.c.plano?.nome}: ${e.message}`);
          }
        }
        S.pos++;
        if (S.pos % 10 === 0) {
          await salvarEstado();
          const ritmo = (Date.now() - t0) / Math.max(1, S.pos - pos0);
          status(`2/3 Abrindo planos: ${S.pos}/${S.fila.length}\n~${Math.round((S.fila.length - S.pos) * ritmo / 3600000 * 10) / 10} h para terminar`);
        }
      }
      S.fase = C.secoes.includes('rede') ? 'rede' : 'planilha';
      await salvarEstado();
    }

    // =============== FASE 3 (opcional): rede credenciada ===============
    if (S.fase === 'rede') {
      const itens = (await ler('itens')) || {};
      const planos = [...new Map(Object.values(itens).map((it) => [`${it.c.plano?.id}|${it.mod}`, it])).values()].sort((a, b) => a.k.localeCompare(b.k));
      let redeTestada = false;
      const descobrirRede = async (it) => {
        const cot = await cotacaoPara(it.q), path = `/cotacoes/${cot}/edit`;
        const resp = await acao('onPlanoSelect', path, [cot, { cidade: it.cidade, modalidade: it.mod, credenciados: [], ...it.c }], true);
        const ids = [...new Set(((resp || '').match(/cenarios\/[0-9a-f-]{36}/g) || []).map((x) => x.split('/')[1]))];
        try { if (ids[0]) await descobrir(`/cotacoes/${cot}/cenarios/${ids[0]}`); }
        finally { for (const id of ids) await acao('removerCenario', path, [cot, id]); }
      };
      while (S.redePos < planos.length) {
        if (E.parar) throw new Parada();
        const it = planos[S.redePos];
        const locais = [];
        for (const tipo of ['Hospitais', 'Laboratórios']) {
          let d = await acao('rede', `/cotacoes/${await cotacaoPara(1)}/edit`, [it.c.plano?.id, it.mod, tipo, '$undefined']);
          if (!d && !redeTestada) { redeTestada = true; await descobrirRede(it); d = await acao('rede', `/cotacoes/${await cotacaoPara(1)}/edit`, [it.c.plano?.id, it.mod, tipo, '$undefined']); }
          if (d) redeTestada = true;
          for (const c of d?.credenciados || []) locais.push({ tipo: c.tipo || tipo, nome: c.nome, endereco: c.endereco || '', bairro: c.bairro || '', cidade: c.cidade?.nome || '', uf: c.uf || c.cidade?.uf || '', regiao: c.regiao || '', atend: (c.atendimentos || []).join(' '), site: c.site || '' });
        }
        await gravar(`rede:${it.c.plano?.id}|${it.mod}`, locais);
        S.redePos++;
        if (S.redePos % 10 === 0) { await salvarEstado(); status(`3/3 Rede credenciada: ${S.redePos}/${planos.length} planos`); }
      }
      S.fase = 'planilha'; await salvarEstado();
    }

    // =============== Planilhas (uma por operadora) ===============
    status('Montando as planilhas…');
    const itens = (await ler('itens')) || {};
    const res = await lerPrefixo('r:');
    const rede = C.secoes.includes('rede') ? await lerPrefixo('rede:') : {};
    const nomeCopart = (c) => (c.tabela?.coparticipacaoTipo || '').trim() || (c.tabela?.coparticipacao ? 'Com coparticipação' : 'Sem coparticipação');
    const acomod = (n) => ({ 0: 'Enfermaria', 1: 'Apartamento' }[n] ?? (n === undefined ? '' : 'Outra'));
    const cab = ['Operadora', 'Administradora', 'Modalidade', 'Produto (região)', 'Tabela', 'Coparticipação', 'Aceita MEI', 'Vidas mín', 'Vidas máx', 'Entidade', 'UFs', 'Qtd. cidades', 'Cidades (amostra)'];
    const W = [22, 20, 9, 34, 32, 20, 8, 8, 8, 16, 10, 9, 40];
    const base = (it) => { const c = it.c; return [c.operadora?.nome || '', c.administradora?.nome && c.administradora.nome !== c.operadora?.nome ? c.administradora.nome : 'Direto', MODS[it.mod], c.produto?.nome || '', (c.tabela?.nome || '').trim(), nomeCopart(c), c.tabela?.mei === true ? 'Sim' : 'Não', c.tabela?.qtdVidaMin ?? '', c.tabela?.qtdVidaMax ?? '', c.entidade?.nome || '', it.ufs.join(', '), it.n, it.amostra.join('; ') + (it.n > it.amostra.length ? ' …' : '')]; };
    const ordem = (a, b) => (a.c.operadora?.nome + a.c.produto?.nome + a.c.tabela?.nome + String(a.c.tabela?.qtdVidaMin).padStart(4, '0') + a.c.plano?.nome).localeCompare(b.c.operadora?.nome + b.c.produto?.nome + b.c.tabela?.nome + String(b.c.tabela?.qtdVidaMin).padStart(4, '0') + b.c.plano?.nome, 'pt-BR');
    const corta = (s) => ((s || '').length > 32000 ? s.slice(0, 32000) + ' [...]' : s || '');
    const ehCarencia = (n) => /car[eê]ncia/i.test(n), ehArea = (n) => /[áa]rea de (comercializa|utiliza)|abrang/i.test(n);
    const abaTextos = (nome, lista, filtro) => {
      const secs = [...new Set(lista.flatMap((it) => Object.keys(res[it.k]?.secoes || {}).filter(filtro)))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      // agrupa planos com o mesmo texto na mesma tabela
      const g = new Map();
      for (const it of lista) {
        const s = res[it.k]?.secoes || {}, vals = secs.map((n) => corta(s[n] || ''));
        if (!vals.some(Boolean)) continue;
        const k = `${it.c.produto?.id}|${it.c.tabela?.id}|${it.mod}|${vals.join('\u0001')}`;
        if (!g.has(k)) g.set(k, { it, vals, planos: [] });
        g.get(k).planos.push(it.c.plano?.nome);
      }
      return { name: nome, widths: [...W, 30, ...secs.map(() => 70)], wrap: secs.map((_, i) => W.length + 1 + i),
        rows: [[...cab, 'Planos', ...secs], ...[...g.values()].map((x) => [...base(x.it), [...new Set(x.planos)].join(', '), ...x.vals])] };
    };

    const arquivos = [];
    for (const op of C.ops) {
      const lista = Object.values(itens).filter((it) => it.g === op).sort(ordem);
      if (!lista.length) { erro(`${op}: nenhuma tabela encontrada`); continue; }
      const sheets = [{ name: 'Preços', widths: [...W, 26, 12, ...FAIXAS.map(() => 12)], money: FAIXAS.map((_, i) => W.length + 2 + i),
        rows: [[...cab, 'Plano', 'Acomodação', ...FAIXAS_TXT], ...lista.map((it) => { const p = res[it.k]?.precos || {}; return [...base(it), it.c.plano?.nome || '', acomod(it.c.plano?.acomodacao), ...FAIXAS.map((f) => p[f === '59-199' ? '59+' : f] ?? '')]; })] }];
      if (C.secoes.includes('area')) sheets.push(abaTextos('Área de comercialização', lista, ehArea));
      if (C.secoes.includes('regras')) sheets.push(abaTextos('Regras', lista, (n) => !ehArea(n) && !ehCarencia(n)));
      if (C.secoes.includes('carencia')) sheets.push(abaTextos('Carências', lista, ehCarencia));
      if (C.secoes.includes('rede')) {
        const planos = [...new Map(lista.map((it) => [`${it.c.plano?.id}|${it.mod}`, it])).values()];
        const linhas = [];
        for (const it of planos) for (const l of rede[`${it.c.plano?.id}|${it.mod}`] || []) linhas.push([it.c.operadora?.nome, it.c.produto?.nome, (it.c.tabela?.nome || '').trim(), it.c.plano?.nome, MODS[it.mod], l.tipo, l.nome, l.endereco, l.bairro, l.cidade, l.uf, l.regiao, l.atend, l.site]);
        sheets.push({ name: 'Rede', widths: [20, 34, 30, 26, 9, 12, 40, 30, 20, 20, 5, 22, 18, 30], rows: [['Operadora', 'Produto (região)', 'Tabela (exemplo)', 'Plano', 'Modalidade', 'Tipo', 'Local', 'Endereço', 'Bairro', 'Cidade', 'UF', 'Região', 'Atendimentos', 'Site'], ...linhas] });
      }
      const semPreco = lista.filter((it) => Object.keys(res[it.k]?.precos || {}).length < 10).length;
      sheets.push({ name: 'Log', widths: [140], rows: [['Ocorrências'], [`Gerado em ${agora()} — ${lista.length} planos (${semPreco} sem preço completo) — estados: ${C.ufs.join(', ')} — cidades: ${C.cidades}`], ...S.erros.filter((e) => e.includes(op)).map((e) => [e])] });
      arquivos.push({ nome: `${semAcento(op).replace(/\s+/g, '_')}_painel_${new Date().toISOString().slice(0, 10)}.xlsx`, sheets });
    }

    // ---------- XLSX (sem bibliotecas) ----------
    const enc = new TextEncoder();
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    const col = (n) => { let s = ''; n++; while (n) { const k = (n - 1) % 26; s = String.fromCharCode(65 + k) + s; n = Math.floor((n - 1) / 26); } return s; };
    const sheetXml = (sh) => {
      const rows = sh.rows, ncol = Math.max(...rows.map((r) => r.length));
      let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
      if (sh.widths) x += '<cols>' + sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
      x += '<sheetData>';
      rows.forEach((r, ri) => {
        x += `<row r="${ri + 1}">`;
        r.forEach((v, ci) => {
          if (v === null || v === undefined || v === '') return;
          const ref = col(ci) + (ri + 1);
          const st = ri === 0 ? ' s="1"' : typeof v === 'number' && sh.money?.includes(ci) ? ' s="2"' : sh.wrap?.includes(ci) ? ' s="3"' : '';
          if (typeof v === 'number' && isFinite(v)) x += `<c r="${ref}"${st}><v>${v}</v></c>`;
          else x += `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        });
        x += '</row>';
      });
      x += '</sheetData>';
      if (rows.length > 1) x += `<autoFilter ref="A1:${col(ncol - 1)}${rows.length}"/>`;
      return x + '</worksheet>';
    };
    const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc32 = (d) => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = crcT[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
    const deflate = async (d) => new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const xlsx = async (sheets) => {
      const files = [], add = (name, str) => files.push({ name, data: enc.encode(str) });
      add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>');
      add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets><definedNames>' + sheets.map((s, i) => (s.rows.length > 1 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name)}'!$A$1:$${col(Math.max(...s.rows.map((r) => r.length)) - 1)}$${s.rows.length}</definedName>` : '')).join('') + '</definedNames></workbook>');
      add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
      add('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot; #,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
      sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
      const partes = [], central = []; let off = 0;
      for (const f of files) {
        const nm = enc.encode(f.name), crc = crc32(f.data), cd = await deflate(f.data);
        const h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 8, true);
        h.setUint32(14, crc, true); h.setUint32(18, cd.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, nm.length, true);
        partes.push(new Uint8Array(h.buffer), nm, cd);
        const c = new DataView(new ArrayBuffer(46));
        c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 8, true);
        c.setUint32(16, crc, true); c.setUint32(20, cd.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
        central.push(new Uint8Array(c.buffer), nm); off += 30 + nm.length + cd.length;
      }
      const csz = central.reduce((a, b) => a + b.length, 0);
      const fim = new DataView(new ArrayBuffer(22));
      fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, files.length, true); fim.setUint16(10, files.length, true); fim.setUint32(12, csz, true); fim.setUint32(16, off, true);
      return new Blob([...partes, ...central, new Uint8Array(fim.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    };
    const baixar = async () => {
      if (window.__extratorSemDownload) { window.__extrator.arquivos = arquivos; return; }
      for (const a of arquivos) {
        const el = document.createElement('a'); el.href = URL.createObjectURL(await xlsx(a.sheets)); el.download = a.nome;
        document.body.appendChild(el); el.click(); el.remove(); await sleep(1500);
      }
    };
    await baixar();
    window.__extrator.baixarDeNovo = baixar;
    S.concluido = true; S.fase = 'concluído'; await salvarEstado();
    status(`✅ Pronto: ${arquivos.length} planilha(s), ${Object.keys(itens).length} planos, ${S.erros.length} ocorrência(s) no Log.\nPara baixar de novo: __extrator.baixarDeNovo()`);
    bParar.remove();
  } catch (e) {
    await salvarEstado();
    if (e instanceof Parada) status('⏸ Parado. Para continuar: cole o código de novo e clique em "Continuar".');
    else { status('❌ ' + e.message + '\nO andamento foi salvo: cole o código de novo e clique em "Continuar".'); console.error(e); }
  } finally { fechar(); }
})();
