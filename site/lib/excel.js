import 'server-only';
import ExcelJS from 'exceljs';
import { db, tudo } from './db';
import { COLS_FAIXA, FAIXAS, rotuloFaixa, slug, orIlike, dataBR, TIPOS_MUDANCA, grupoDe } from './util';
import { contextoDetalhe, detalhe } from './detalhe';

const AZUL = 'FF0B6BCB';

// ---- desconto por quantidade: regra e explicação de como aplicar ----
const TOL = 0.3;
const arredPct = (p) => (Math.abs(p - Math.round(p)) <= 0.02 ? Math.round(p) : Math.round(p * 100) / 100);
const fmtPct = (p) => `${String(p).replace('.', ',')}%`;
function faixasDe(regra) {
  const pontos = [...(regra || [])].map((r) => ({ ...r, pct: r.bruto > 0 && r.total < r.bruto ? (1 - r.total / r.bruto) * 100 : 0 }))
    .sort((a, b) => a.vidas - b.vidas);
  const fx = [];
  for (const p of pontos) {
    const u = fx[fx.length - 1];
    if (u && Math.abs(u.base - p.pct) <= TOL) u.ate = p.vidas;
    else fx.push({ de: p.vidas, ate: p.vidas, pct: arredPct(p.pct), base: p.pct });
  }
  if (fx.length) fx[fx.length - 1].ate = null;
  return fx;
}
const rotQtd = (f, pessoas = true) => (f.ate === null ? `${f.de} ou mais${pessoas ? ' pessoas' : ''}` : f.de === f.ate ? `${f.de} ${f.de === 1 ? 'pessoa' : 'pessoas'}` : `${f.de} a ${f.ate} pessoas`);
export function textoRegra(regra) {
  const fx = faixasDe(regra);
  if (!fx.length) return '';
  if (fx.every((f) => !f.pct)) return 'Sem desconto por quantidade';
  if (fx.length === 1) return `${fmtPct(fx[0].pct)} em qualquer quantidade (campanha da tabela)`;
  return fx.map((f) => `${f.ate === null ? `${f.de} ou mais` : f.de === f.ate ? f.de : `${f.de} a ${f.ate}`}: ${f.pct ? fmtPct(f.pct) : 'sem desconto'}`).join(' · ');
}
export function comoAplicar(regra) {
  const fx = faixasDe(regra);
  if (!fx.length) return '';
  if (fx.every((f) => !f.pct)) return 'Não há desconto por número de pessoas: cada beneficiário paga o valor da tabela.';
  const porVidas = new Map((regra || []).map((r) => [r.vidas, r]));
  const exemplo = (f) => {
    const r = porVidas.get(f.de);
    if (!r || !r.vidas) return '';
    return r.vidas === 1
      ? ` (ex.: 1 pessoa de 29 a 33 anos paga ${brlTxt(r.total)} em vez de ${brlTxt(r.bruto)})`
      : ` (ex.: ${r.vidas} pessoas de 29 a 33 anos pagam ${brlTxt(r.total / r.vidas)} cada, em vez de ${brlTxt(r.bruto / r.vidas)})`;
  };
  if (fx.length === 1) {
    return `Campanha da tabela: desconto de ${fmtPct(fx[0].pct)} sobre a mensalidade de todos os beneficiários, com qualquer quantidade de pessoas${exemplo(fx[0])}. Os valores da aba "Preços com desconto" já consideram esse desconto.`;
  }
  const partes = fx.map((f) => `com ${rotQtd(f)}, ${f.pct ? `${fmtPct(f.pct)} sobre a mensalidade de cada uma${exemplo(f)}` : 'sem desconto'}`);
  return `O desconto depende de quantas pessoas entram no mesmo contrato e vale para todas elas: ${partes.join('; ')}.`;
}
const pctExato = (r) => (r.bruto > 0 && r.total < r.bruto ? Math.round((1 - r.total / r.bruto) * 10000) / 100 : 0);
const brlTxt = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });


function cabecalho(ws, linha, colunas) {
  const r = ws.getRow(linha);
  colunas.forEach((c, i) => { r.getCell(i + 1).value = c; });
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
  r.alignment = { vertical: 'middle', wrapText: true };
  r.height = 30;
  ws.views = [{ state: 'frozen', ySplit: linha }];
  ws.autoFilter = { from: { row: linha, column: 1 }, to: { row: linha, column: colunas.length } };
}

function larguras(ws, ls) { ls.forEach((w, i) => { ws.getColumn(i + 1).width = w; }); }

async function logo(wb, ws, grupo) {
  if (!grupo) return false;
  try {
    const { data } = await db().storage.from('logos').download(`${slug(grupo)}.png`);
    if (!data) return false;
    const id = wb.addImage({ buffer: Buffer.from(await data.arrayBuffer()), extension: 'png' });
    ws.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: 140, height: 44 } });
    return true;
  } catch { return false; }
}

function titulo(ws, texto, sub, comLogo) {
  ws.getRow(1).height = 36;
  const c = ws.getCell(comLogo ? 'C1' : 'A1');
  c.value = texto; c.font = { bold: true, size: 14 };
  const s = ws.getCell(comLogo ? 'C2' : 'A2');
  s.value = sub; s.font = { color: { argb: 'FF5F6B7A' } };
}

export async function resolverCidade(nome, uf) {
  if (!nome) return null;
  let q = db().from('cidades').select('id,nome,uf,uf_id').ilike('nome', nome.trim());
  if (uf) q = q.eq('uf', uf);
  const { data } = await q.limit(5);
  return data?.[0] || null;
}

// Valores que parecem erro de cadastro no Cotador (o sistema não altera nada, só aponta).
export function suspeitasDe(l) {
  const v = COLS_FAIXA.map((c) => (l[c] == null ? null : Number(l[c])));
  const out = [];
  for (let i = 1; i < v.length; i++) {
    if (v[i] == null || v[i - 1] == null) continue;
    if (v[i] < v[i - 1] * 0.98) out.push({ col: i, motivo: `${rotuloFaixa(FAIXAS[i])} (${brlTxt(v[i])}) é menor que a faixa anterior (${brlTxt(v[i - 1])})` });
    else if (v[i] > v[i - 1] * 3) out.push({ col: i, motivo: `${rotuloFaixa(FAIXAS[i])} (${brlTxt(v[i])}) é mais de 3x a faixa anterior (${brlTxt(v[i - 1])})` });
  }
  if (v[0] && v[9] && v[9] / v[0] > 6.005) out.push({ col: 9, motivo: `${rotuloFaixa(FAIXAS[9])} é ${(v[9] / v[0]).toFixed(2).replace('.', ',')}x a primeira faixa (limite da ANS: 6x)` });
  return out;
}
const AMARELO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2A8' } };

// Planos com o mesmo nome dentro da mesma tabela/UF recebem o código para não confundir.
function nomesDePlano(linhas) {
  const ids = new Map();
  for (const l of linhas) { const k = `${l.tabela_id}|${l.uf}|${l.plano}`; if (!ids.has(k)) ids.set(k, new Set()); ids.get(k).add(l.plano_id); }
  return (l) => (ids.get(`${l.tabela_id}|${l.uf}|${l.plano}`)?.size > 1 ? `${l.plano} (cód. ${l.plano_id})` : l.plano);
}

export async function planilhaPrecos({ grupo, cidade, tipo, admin }) {
  const s = db();
  const linhas = await tudo(() => s.rpc('planilha_precos', { p_grupo: grupo || null, p_cidade: cidade?.id || null, p_tipo: tipo || null, p_admin: admin || null }));

  // Tabelas do recorte (mesmo sem preço ainda)
  let qt = () => {
    let q = s.from('v_tabelas').select('id,nome,operadora,grupo,administradora,tipo_tabela,minimo_vidas,exige_entidade,planos,ufs,cidades').eq('ativa', true);
    if (grupo) q = q.eq('grupo', grupo);
    if (tipo) q = q.eq('tipo_tabela', tipo);
    if (admin === '__administradoras__') q = q.neq('administradora', 'direto');
    else if (admin) q = q.eq('administradora', admin);
    return q.order('nome');
  };
  let tabelas = await tudo(qt);
  if (cidade) {
    const vinc = new Set((await tudo(() => s.from('tabela_cidade').select('tabela_id').eq('cidade_id', cidade.id))).map((v) => v.tabela_id));
    tabelas = tabelas.filter((t) => vinc.has(t.id));
  }
  const ids = tabelas.map((t) => t.id);
  const nomePlano = new Map();
  for (const t of tabelas) for (const p of t.planos || []) nomePlano.set(p.id, p.nome);
  const nomeTab = new Map(tabelas.map((t) => [t.id, t.nome]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Monitor de Tabelas';
  const recorte = `${grupo || 'Todas as operadoras'} — ${cidade ? `${cidade.nome}/${cidade.uf}` : 'todas as cidades'}${tipo ? ` — ${tipo}` : ''}${admin ? ` — ${admin === '__administradoras__' ? 'administradoras' : admin === 'direto' ? 'direto da operadora' : admin}` : ''}`;
  const hoje = dataBR(new Date());

  // Descontos por quantidade de vidas (conferidos semanalmente)
  const descontos = [];
  for (let i = 0; i < ids.length; i += 150) {
    descontos.push(...await tudo(() => {
      let q = s.from('descontos').select('*').in('tabela_id', ids.slice(i, i + 150));
      if (cidade) q = q.eq('uf_id', cidade.uf_id);
      return q;
    }));
  }
  const descPorLinha = new Map(descontos.map((d) => [`${d.tabela_id}|${d.uf}|${d.plano}|${d.acomodacao}|${d.coparticipacao}`, d]));

  // Preços
  const ws = wb.addWorksheet('Preços');
  const temLogo = await logo(wb, ws, grupo);
  titulo(ws, `Tabela de preços — ${recorte}`, `Valor de tabela (cheio), mensal por beneficiário, conforme o Cotador Simplificado em ${hoje}. Descontos e campanhas na coluna Desconto e na aba "Preços com desconto".`, temLogo);
  const cols = ['Operadora', 'Tabela', 'Administradora', 'Tipo', 'Mín. vidas', 'UF', 'Plano', 'Acomodação', 'Coparticipação', 'Taxa de adesão',
    ...FAIXAS.map(rotuloFaixa), 'Desconto (%)', 'Desconto por quantidade de vidas', 'Encerrada', 'Preço novo em'];
  cabecalho(ws, 4, cols);
  const plano = nomesDePlano(linhas);
  const conferir = [];
  for (const l of linhas) {
    const row = ws.addRow([l.operadora, l.tabela, l.administradora, l.tipo_tabela, l.minimo_vidas, l.uf, plano(l), l.acomodacao, l.coparticipacao,
      l.taxa_adesao, ...COLS_FAIXA.map((c) => (l[c] == null ? null : Number(l[c]))), l.desconto != null ? Number(l.desconto) / 100 : null,
      (() => { const d = descPorLinha.get(`${l.tabela_id}|${l.uf}|${l.plano}|${l.acomodacao}|${l.coparticipacao}`); return d ? (textoRegra(d.regra) || d.texto) : ''; })(),
      l.encerrada ? 'Sim' : '', l.novo_preco_em ? new Date(l.novo_preco_em) : null]);
    for (let i = 11; i <= 20; i++) row.getCell(i).numFmt = '"R$" #,##0.00';
    row.getCell(21).numFmt = '0.##%';
    row.getCell(24).numFmt = 'dd/mm/yyyy';
    const sus = suspeitasDe(l);
    for (const x of sus) { const c = row.getCell(11 + x.col); c.fill = AMARELO; c.note = `Conferir: ${x.motivo}. Valor igual ao do Cotador Simplificado.`; }
    if (sus.length) conferir.push({ l, sus });
  }
  if (!linhas.length) ws.addRow(['Ainda não há preços conferidos para este recorte. Eles entram após a conferência diária.']);
  larguras(ws, [16, 38, 14, 7, 8, 5, 26, 13, 24, 10, ...FAIXAS.map(() => 11), 10, 44, 10, 12]);

  // Aba Conferir: valores com cara de erro de cadastro e planos repetidos
  const repetidos = new Map();
  for (const l of linhas) { const k = `${l.tabela_id}|${l.uf}|${l.plano}|${l.acomodacao}|${l.coparticipacao}`; if (!repetidos.has(k)) repetidos.set(k, []); repetidos.get(k).push(l); }
  const dup = [...repetidos.values()].filter((ls) => new Set(ls.map((x) => x.plano_id)).size > 1);
  if (conferir.length || dup.length) {
    const wq = wb.addWorksheet('Conferir');
    titulo(wq, `Valores para conferir — ${recorte}`, 'Os valores são exatamente os do Cotador Simplificado. Estes parecem erro de cadastro: confirme com a operadora/administradora antes de usar. Na aba Preços as células estão em amarelo.', false);
    cabecalho(wq, 4, ['Operadora', 'Tabela', 'Administradora', 'Tipo', 'UF', 'Plano', 'Acomodação', 'Coparticipação', 'O que parece errado', ...FAIXAS.map(rotuloFaixa)]);
    const add = (l, motivo, cols) => {
      const row = wq.addRow([l.operadora, l.tabela, l.administradora, l.tipo_tabela, l.uf, plano(l), l.acomodacao, l.coparticipacao, motivo,
        ...COLS_FAIXA.map((c) => (l[c] == null ? null : Number(l[c])))]);
      for (let i = 10; i <= 19; i++) row.getCell(i).numFmt = '"R$" #,##0.00';
      for (const c of cols) row.getCell(10 + c).fill = AMARELO;
    };
    for (const { l, sus } of conferir) add(l, sus.map((x) => x.motivo).join('; '), sus.map((x) => x.col));
    for (const ls of dup) for (const l of ls) add(l, `Plano "${l.plano}" aparece ${ls.length} vezes nesta tabela com preços diferentes (códigos ${ls.map((x) => x.plano_id).join(' e ')}); o Cotador não diz a diferença`, []);
    larguras(wq, [16, 36, 14, 7, 5, 28, 13, 22, 60, ...FAIXAS.map(() => 11)]);
    wq.getColumn(9).alignment = { wrapText: true, vertical: 'top' };
  }

  // Aba Descontos: regra por quantidade de vidas, uma linha por plano/acomodação/coparticipação
  const QTDS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30];
  const tabInfo = new Map(tabelas.map((t) => [t.id, t]));
  const wdsc = wb.addWorksheet('Descontos');
  cabecalho(wdsc, 1, ['Operadora', 'Administradora', 'Tabela', 'Tipo', 'Plano', 'Acomodação', 'Coparticipação', 'UF', 'Regra de desconto por quantidade', 'Como aplicar', 'Maior desconto',
    ...QTDS.map((q) => `${q} ${q === 1 ? 'pessoa' : 'pessoas'}`), 'Exemplo 29 a 33 anos: valor cheio', 'Com o maior desconto', 'Conferido em']);
  const ordenados = descontos.slice().sort((a, b) => (b.tem_desconto - a.tem_desconto) || `${a.uf}${a.tabela_id}${a.plano}`.localeCompare(`${b.uf}${b.tabela_id}${b.plano}`));
  for (const d of ordenados) {
    const t = tabInfo.get(d.tabela_id) || {};
    const porQ = new Map((d.regra || []).map((r) => [r.vidas, r]));
    const maior = (d.regra || []).reduce((m, r) => (r.pct > (m?.pct ?? -1) ? r : m), null);
    const row = wdsc.addRow([t.operadora, t.administradora, t.nome, t.tipo_tabela, d.plano, d.acomodacao, d.coparticipacao, d.uf, textoRegra(d.regra) || d.texto,
      comoAplicar(d.regra), Math.max(0, ...(d.regra || []).map(pctExato)) / 100,
      ...QTDS.map((q) => (porQ.has(q) ? pctExato(porQ.get(q)) / 100 : null)),
      maior ? maior.bruto / maior.vidas : null, maior ? maior.total / maior.vidas : null, d.atualizado_em ? new Date(d.atualizado_em) : null]);
    row.getCell(11).numFmt = '0.##%';
    for (let i = 12; i < 12 + QTDS.length; i++) row.getCell(i).numFmt = '0.##%';
    row.getCell(12 + QTDS.length).numFmt = row.getCell(13 + QTDS.length).numFmt = '"R$" #,##0.00';
    row.getCell(14 + QTDS.length).numFmt = 'dd/mm/yyyy';
  }
  if (!descontos.length) wdsc.addRow(['Descontos por quantidade ainda não conferidos para este recorte (conferência semanal, às segundas).']);
  larguras(wdsc, [16, 14, 36, 7, 24, 12, 22, 5, 46, 80, 10, ...QTDS.map(() => 9), 14, 14, 12]);
  wdsc.getColumn(10).alignment = { wrapText: true, vertical: 'top' };

  // Preços com desconto (campanhas e descontos da tabela, ex.: 75% na linha empresarial)
  const comDesc = (await tudo(() => s.rpc('planilha_precos', { p_grupo: grupo || null, p_cidade: cidade?.id || null, p_tipo: tipo || null, p_admin: admin || null, p_com_desconto: true })))
    .filter((l) => Number(l.desconto) > 0);
  const wpd = wb.addWorksheet('Preços com desconto');
  titulo(wpd, `Preços com desconto — ${recorte}`, `Somente planos com desconto ou campanha ativa no cotador em ${hoje}. O cotador não informa a validade da campanha.`, false);
  cabecalho(wpd, 4, ['Operadora', 'Tabela', 'Administradora', 'Tipo', 'Mín. vidas', 'UF', 'Plano', 'Acomodação', 'Coparticipação', 'Desconto (%)', ...FAIXAS.map(rotuloFaixa)]);
  for (const l of comDesc) {
    const row = wpd.addRow([l.operadora, l.tabela, l.administradora, l.tipo_tabela, l.minimo_vidas, l.uf, plano(l), l.acomodacao, l.coparticipacao,
      Number(l.desconto) / 100, ...COLS_FAIXA.map((c) => (l[c] == null ? null : Number(l[c])))]);
    row.getCell(10).numFmt = '0.##%';
    for (let i = 11; i <= 20; i++) row.getCell(i).numFmt = '"R$" #,##0.00';
  }
  if (!comDesc.length) wpd.addRow(['Nenhum plano com desconto ou campanha neste recorte (ou os preços ainda não foram conferidos).']);
  larguras(wpd, [16, 38, 14, 7, 8, 5, 26, 13, 24, 10, ...FAIXAS.map(() => 11)]);

  // Tabelas e planos
  const wt = wb.addWorksheet('Tabelas e planos');
  cabecalho(wt, 1, ['Operadora', 'Tabela', 'Administradora', 'Tipo', 'Mín. vidas', 'Exige entidade', 'UFs', 'Cidades', 'Planos']);
  for (const t of tabelas) wt.addRow([t.operadora, t.nome, t.administradora, t.tipo_tabela, t.minimo_vidas, t.exige_entidade ? 'Sim' : 'Não',
    (t.ufs || []).join(', '), t.cidades, (t.planos || []).map((p) => p.nome).join(' | ')]);
  larguras(wt, [16, 40, 14, 7, 9, 10, 30, 9, 70]);

  // Coparticipação e carência
  const filtroUf = (q) => (cidade ? q.eq('uf_id', cidade.uf_id) : q);
  const lerEm = async (tabela, colunas) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 150) out.push(...await tudo(() => filtroUf(s.from(tabela).select(colunas).in('tabela_id', ids.slice(i, i + 150)))));
    return out;
  };
  const ufNome = new Map((await tudo(() => s.from('cidades').select('uf_id,uf').limit(100000))).map((c) => [c.uf_id, c.uf]));
  const wc = wb.addWorksheet('Coparticipação');
  cabecalho(wc, 1, ['Tabela', 'Plano', 'UF', 'Opção de coparticipação', 'Tabela de copart.', 'Vigência', 'Item', 'Valor / %']);
  for (const c of await lerEm('coparticipacao', '*')) {
    const itens = c.itens?.length ? c.itens : [{ item: /^sem/i.test(c.coparticipacao || '')
      ? '(opção sem coparticipação — não se aplica)'
      : '(o Cotador não tem tabela de coparticipação vigente para este plano — confirmar com a operadora)' }];
    for (const it of itens) wc.addRow([nomeTab.get(c.tabela_id), nomePlano.get(c.plano_id), ufNome.get(c.uf_id), c.coparticipacao, c.nome,
      c.vigencia_inicio ? `${dataBR(c.vigencia_inicio)} a ${dataBR(c.vigencia_fim)}` : '', it.item, it.text_valor_copart ?? it.percent_text ?? '']);
  }
  larguras(wc, [36, 24, 5, 24, 30, 22, 30, 24]);

  const wk = wb.addWorksheet('Carência');
  cabecalho(wk, 1, ['Tabela', 'Plano', 'UF', 'Tabela de carência', 'Vigência', 'Prazo', 'Cobertura', 'Regras de aceitação']);
  const vistos = new Set();
  const carencias = await lerEm('carencia', '*');
  const comCarencia = new Set(carencias.filter((c) => c.itens?.length).map((c) => `${c.tabela_id}|${c.uf_id}`));
  for (const c of carencias) {
    if (!c.itens?.length && comCarencia.has(`${c.tabela_id}|${c.uf_id}`)) continue;
    const k = `${c.tabela_id}|${c.uf_id}|${c.carencia_id}`; // carência costuma ser igual para todos os planos da tabela
    if (vistos.has(k)) continue; vistos.add(k);
    const regras = (c.regras_aceitacao || []).map((r) => (typeof r === 'string' ? r : r.texto || r.text || JSON.stringify(r))).join(' | ');
    const itens = (c.itens || []).slice().sort((a, b) => (a.rank || 0) - (b.rank || 0));
    if (!itens.length) wk.addRow([nomeTab.get(c.tabela_id), 'todos', ufNome.get(c.uf_id), '(o Cotador não tem tabela de carência vigente — confirmar com a operadora)']);
    itens.forEach((it, i) => wk.addRow([nomeTab.get(c.tabela_id), 'todos', ufNome.get(c.uf_id), c.nome,
      c.vigencia_inicio ? `${dataBR(c.vigencia_inicio)} a ${dataBR(c.vigencia_fim)}` : '', it.tempo, (it.text_carencia || '').replace(/\s+/g, ' '), i === 0 ? regras : '']));
  }
  larguras(wk, [36, 8, 5, 28, 22, 10, 90, 40]);
  wk.getColumn(7).alignment = { wrapText: true, vertical: 'top' };

  // Área
  const wa = wb.addWorksheet('Área de comercialização');
  cabecalho(wa, 1, ['Tabela', 'UF', 'Cidade']);
  if (cidade) {
    for (const t of tabelas) wa.addRow([t.nome, cidade.uf, cidade.nome]);
  } else {
    const cid = new Map((await tudo(() => s.from('cidades').select('id,nome,uf'))).map((c) => [c.id, c]));
    for (let i = 0; i < ids.length; i += 100) {
      const vs = await tudo(() => s.from('tabela_cidade').select('tabela_id,cidade_id').in('tabela_id', ids.slice(i, i + 100)));
      for (const v of vs) { const c = cid.get(v.cidade_id); if (c) wa.addRow([nomeTab.get(v.tabela_id), c.uf, c.nome]); }
    }
  }
  larguras(wa, [44, 5, 32]);

  // Rede (só para uma cidade — para todas seria grande demais)
  const wr = wb.addWorksheet('Rede credenciada');
  cabecalho(wr, 1, ['Tabela', 'Plano', 'Cidade', 'Local', 'Tipo', 'Cobertura', 'Atualizado em']);
  if (cidade) {
    for (let i = 0; i < ids.length; i += 100) {
      const rs = await tudo(() => s.from('rede').select('*').eq('cidade_id', cidade.id).in('tabela_id', ids.slice(i, i + 100)));
      for (const r of rs) for (const l of r.locais || []) wr.addRow([nomeTab.get(r.tabela_id), r.plano, cidade.nome, l.nome, l.tipo, l.cobertura, dataBR(r.atualizado_em)]);
    }
  } else {
    wr.addRow(['Para todas as cidades a rede fica num arquivo próprio: aba "Rede" do site (ou escolha uma cidade aqui).']);
  }
  larguras(wr, [36, 24, 20, 48, 8, 20, 12]);

  const sufAdmin = admin === '__administradoras__' ? '-administradoras' : admin ? `-${slug(admin)}` : '';
  const nome = `precos-${slug(grupo || 'todas')}${sufAdmin}-${cidade ? slug(cidade.nome) + '-' + cidade.uf.toLowerCase() : 'todas-cidades'}.xlsx`;
  return { buffer: await wb.xlsx.writeBuffer(), nome };
}

export async function planilhaAlteracoes(filtros) {
  const s = db();
  const linhas = await tudo(() => aplicarFiltrosMudancas(s.from('mudancas').select('*'), filtros).order('id', { ascending: false }));
  const ctx = await contextoDetalhe(linhas);
  const nomeTab = (id) => ctx.tabelas.get(id)?.nome || (id ? String(id) : '');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Monitor de Tabelas';

  // 1) Resumo: uma linha por alteração
  const ws = wb.addWorksheet('Alterações');
  cabecalho(ws, 1, ['Data', 'Operadora', 'Tipo', 'Tabela', 'Administradora', 'UF', 'Resumo', 'Itens no detalhe', 'Lida']);
  for (const m of linhas) {
    const t = ctx.tabelas.get(m.tabela_id);
    const d = detalhe(m, ctx);
    const r = ws.addRow([new Date(m.detectado_em), grupoDe(m.operadora), TIPOS_MUDANCA[m.tipo] || m.tipo, nomeTab(m.tabela_id), t?.administradora || '', m.uf, m.descricao, d.linhas.length, m.lida ? 'Sim' : 'Não']);
    r.getCell(1).numFmt = 'dd/mm/yyyy hh:mm';
  }
  if (!linhas.length) ws.addRow(['Nenhuma alteração neste filtro.']);
  larguras(ws, [16, 16, 20, 40, 14, 5, 100, 10, 6]);
  ws.getColumn(7).alignment = { wrapText: true, vertical: 'top' };

  // 2) Uma aba por tipo, com o detalhe completo de cada alteração
  const ordem = Object.keys(TIPOS_MUDANCA);
  const tipos = [...new Set(linhas.map((m) => m.tipo))].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
  for (const tipo of tipos) {
    const ms = linhas.filter((m) => m.tipo === tipo);
    const amostra = ms.map((m) => detalhe(m, ctx)).find((d) => d.colunas.length) || { colunas: [] };
    const nomeAba = (TIPOS_MUDANCA[tipo] || tipo).replace(/[\\/?*[\]:]/g, '').slice(0, 31);
    const wt = wb.addWorksheet(nomeAba);
    const fixas = ['Data', 'Operadora', 'Tabela', 'UF'];
    cabecalho(wt, 1, [...fixas, ...amostra.colunas, 'Observação']);
    for (const m of ms) {
      const d = detalhe(m, ctx);
      const base = [new Date(m.detectado_em), grupoDe(m.operadora), nomeTab(m.tabela_id), m.uf || ''];
      const moeda = new Set(d.moeda || []);
      if (!d.linhas.length) { const r = wt.addRow([...base, ...amostra.colunas.map(() => null), d.aviso || m.descricao]); r.getCell(1).numFmt = 'dd/mm/yyyy'; continue; }
      d.linhas.forEach((l, i) => {
        const r = wt.addRow([...base, ...l, i === 0 ? (d.aviso || '') : '']);
        r.getCell(1).numFmt = 'dd/mm/yyyy';
        for (const j of moeda) if (typeof l[j] === 'number') r.getCell(fixas.length + 1 + j).numFmt = '"R$" #,##0.00';
      });
    }
    larguras(wt, [11, 16, 40, 5, ...amostra.colunas.map((c) => (/Cidade|Local|Plano|Item|Cobertura|Regra/.test(c) ? 34 : 14)), 40]);
  }
  const partes = ['alteracoes', ...(filtros.grupos || (filtros.grupo ? [filtros.grupo] : [])).map(slug)];
  return { buffer: await wb.xlsx.writeBuffer(), nome: `${partes.join('-')}-${new Date().toISOString().slice(0, 10)}.xlsx` };
}

export function aplicarFiltrosMudancas(q, { grupo, grupos, tipo, de, ate, lida, falsos }) {
  if (grupo) q = q.or(orIlike(grupo));
  else if (grupos?.length) q = q.or(grupos.map((g) => orIlike(g)).join(','));
  if (!falsos) q = q.eq('falso_positivo', false);
  if (tipo) q = q.eq('tipo', tipo);
  if (de) q = q.gte('detectado_em', `${de}T00:00:00-03:00`);
  if (ate) q = q.lte('detectado_em', `${ate}T23:59:59-03:00`);
  if (lida === 'nao') q = q.eq('lida', false);
  if (lida === 'sim') q = q.eq('lida', true);
  return q;
}
