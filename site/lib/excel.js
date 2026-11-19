import 'server-only';
import ExcelJS from 'exceljs';
import { db, tudo } from './db';
import { COLS_FAIXA, FAIXAS, rotuloFaixa, slug, orIlike, dataBR, TIPOS_MUDANCA, grupoDe } from './util';

const AZUL = 'FF0B6BCB';

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

export async function planilhaPrecos({ grupo, cidade, tipo, admin }) {
  const s = db();
  const linhas = await tudo(() => s.rpc('planilha_precos', { p_grupo: grupo || null, p_cidade: cidade?.id || null, p_tipo: tipo || null, p_admin: admin || null }));

  // Tabelas do recorte (mesmo sem preço ainda)
  let qt = () => {
    let q = s.from('v_tabelas').select('id,nome,operadora,grupo,administradora,tipo_tabela,minimo_vidas,exige_entidade,planos,ufs,cidades').eq('ativa', true);
    if (grupo) q = q.eq('grupo', grupo);
    if (tipo) q = q.eq('tipo_tabela', tipo);
    if (admin) q = q.eq('administradora', admin);
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
  const recorte = `${grupo || 'Todas as operadoras'} — ${cidade ? `${cidade.nome}/${cidade.uf}` : 'todas as cidades'}${tipo ? ` — ${tipo}` : ''}${admin ? ` — ${admin}` : ''}`;
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
  titulo(ws, `Tabela de preços — ${recorte}`, `Valores mensais por beneficiário, conforme o Cotador Simplificado em ${hoje}.`, temLogo);
  const cols = ['Operadora', 'Tabela', 'Administradora', 'Tipo', 'Mín. vidas', 'UF', 'Plano', 'Acomodação', 'Coparticipação', 'Taxa de adesão',
    ...FAIXAS.map(rotuloFaixa), 'Desconto (%)', 'Desconto por quantidade de vidas', 'Encerrada', 'Preço novo em'];
  cabecalho(ws, 4, cols);
  for (const l of linhas) {
    const row = ws.addRow([l.operadora, l.tabela, l.administradora, l.tipo_tabela, l.minimo_vidas, l.uf, l.plano, l.acomodacao, l.coparticipacao,
      l.taxa_adesao, ...COLS_FAIXA.map((c) => (l[c] == null ? null : Number(l[c]))), l.desconto,
      descPorLinha.get(`${l.tabela_id}|${l.uf}|${l.plano}|${l.acomodacao}|${l.coparticipacao}`)?.texto || '',
      l.encerrada ? 'Sim' : '', l.novo_preco_em ? new Date(l.novo_preco_em) : null]);
    for (let i = 11; i <= 20; i++) row.getCell(i).numFmt = '"R$" #,##0.00';
    row.getCell(24).numFmt = 'dd/mm/yyyy';
  }
  if (!linhas.length) ws.addRow(['Ainda não há preços conferidos para este recorte. Eles entram após a conferência diária.']);
  larguras(ws, [16, 38, 14, 7, 8, 5, 26, 13, 24, 10, ...FAIXAS.map(() => 11), 10, 44, 10, 12]);

  // Aba Descontos: regra por quantidade de vidas, uma linha por plano/acomodação/coparticipação
  const QTDS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30];
  const tabInfo = new Map(tabelas.map((t) => [t.id, t]));
  const wdsc = wb.addWorksheet('Descontos');
  cabecalho(wdsc, 1, ['Operadora', 'Administradora', 'Tabela', 'Tipo', 'Plano', 'Acomodação', 'Coparticipação', 'UF', 'Regra de desconto por quantidade', 'Maior desconto',
    ...QTDS.map((q) => `${q} ${q === 1 ? 'pessoa' : 'pessoas'}`), 'Exemplo 29 a 33 anos: valor cheio', 'Com o maior desconto', 'Conferido em']);
  const ordenados = descontos.slice().sort((a, b) => (b.tem_desconto - a.tem_desconto) || `${a.uf}${a.tabela_id}${a.plano}`.localeCompare(`${b.uf}${b.tabela_id}${b.plano}`));
  for (const d of ordenados) {
    const t = tabInfo.get(d.tabela_id) || {};
    const porQ = new Map((d.regra || []).map((r) => [r.vidas, r]));
    const maior = (d.regra || []).reduce((m, r) => (r.pct > (m?.pct ?? -1) ? r : m), null);
    const row = wdsc.addRow([t.operadora, t.administradora, t.nome, t.tipo_tabela, d.plano, d.acomodacao, d.coparticipacao, d.uf, d.texto,
      d.maior_pct ? Number(d.maior_pct) / 100 : 0,
      ...QTDS.map((q) => (porQ.has(q) ? porQ.get(q).pct / 100 : null)),
      maior ? maior.bruto / maior.vidas : null, maior ? maior.total / maior.vidas : null, d.atualizado_em ? new Date(d.atualizado_em) : null]);
    row.getCell(10).numFmt = '0.0%';
    for (let i = 11; i < 11 + QTDS.length; i++) row.getCell(i).numFmt = '0.0%';
    row.getCell(11 + QTDS.length).numFmt = row.getCell(12 + QTDS.length).numFmt = '"R$" #,##0.00';
    row.getCell(13 + QTDS.length).numFmt = 'dd/mm/yyyy';
  }
  if (!descontos.length) wdsc.addRow(['Descontos por quantidade ainda não conferidos para este recorte (conferência semanal, às segundas).']);
  larguras(wdsc, [16, 14, 36, 7, 24, 12, 22, 5, 50, 10, ...QTDS.map(() => 9), 14, 14, 12]);

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
    const itens = c.itens?.length ? c.itens : [{ item: '(sem tabela vigente)' }];
    for (const it of itens) wc.addRow([nomeTab.get(c.tabela_id), nomePlano.get(c.plano_id), ufNome.get(c.uf_id), c.coparticipacao, c.nome,
      c.vigencia_inicio ? `${dataBR(c.vigencia_inicio)} a ${dataBR(c.vigencia_fim)}` : '', it.item, it.text_valor_copart ?? it.percent_text ?? '']);
  }
  larguras(wc, [36, 24, 5, 24, 30, 22, 30, 24]);

  const wk = wb.addWorksheet('Carência');
  cabecalho(wk, 1, ['Tabela', 'Plano', 'UF', 'Tabela de carência', 'Vigência', 'Prazo', 'Cobertura', 'Regras de aceitação']);
  const vistos = new Set();
  for (const c of await lerEm('carencia', '*')) {
    const k = `${c.tabela_id}|${c.uf_id}|${c.carencia_id}`; // carência costuma ser igual para todos os planos da tabela
    if (vistos.has(k)) continue; vistos.add(k);
    const regras = (c.regras_aceitacao || []).map((r) => (typeof r === 'string' ? r : r.texto || r.text || JSON.stringify(r))).join(' | ');
    const itens = (c.itens || []).slice().sort((a, b) => (a.rank || 0) - (b.rank || 0));
    if (!itens.length) wk.addRow([nomeTab.get(c.tabela_id), 'todos', ufNome.get(c.uf_id), '(sem tabela vigente)']);
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
    wr.addRow(['Escolha uma cidade para baixar a rede credenciada (para todas as cidades o arquivo ficaria grande demais).']);
  }
  larguras(wr, [36, 24, 20, 48, 8, 20, 12]);

  const nome = `precos-${slug(grupo || 'todas')}-${cidade ? slug(cidade.nome) + '-' + cidade.uf.toLowerCase() : 'todas-cidades'}.xlsx`;
  return { buffer: await wb.xlsx.writeBuffer(), nome };
}

export async function planilhaAlteracoes(filtros) {
  const s = db();
  const linhas = await tudo(() => aplicarFiltrosMudancas(s.from('mudancas').select('*'), filtros).order('id', { ascending: false }));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Alterações');
  cabecalho(ws, 1, ['Data', 'Operadora', 'Tipo', 'UF', 'Tabela (id)', 'Descrição', 'Lida']);
  for (const m of linhas) {
    const r = ws.addRow([new Date(m.detectado_em), grupoDe(m.operadora), TIPOS_MUDANCA[m.tipo] || m.tipo, m.uf, m.tabela_id, m.descricao, m.lida ? 'Sim' : 'Não']);
    r.getCell(1).numFmt = 'dd/mm/yyyy hh:mm';
  }
  larguras(ws, [16, 16, 18, 5, 10, 110, 6]);
  ws.getColumn(6).alignment = { wrapText: true, vertical: 'top' };

  // Detalhe de preço: uma linha por combinação que mudou
  const wd = wb.addWorksheet('Detalhe de preços');
  cabecalho(wd, 1, ['Data', 'Operadora', 'Tabela', 'UF', 'Plano', 'Faixa', 'Acomodação', 'Coparticipação', 'Antes', 'Depois', 'Variação']);
  const precoMud = linhas.filter((m) => m.tipo === 'preco' && Array.isArray(m.depois));
  const chaves = [...new Set(precoMud.flatMap((m) => m.depois.map((d) => d.chave)))];
  const info = new Map();
  for (let i = 0; i < chaves.length; i += 200) {
    const { data } = await s.from('precos').select('chave,plano,uf').in('chave', chaves.slice(i, i + 200));
    for (const p of data || []) info.set(p.chave, p);
  }
  const tabIds = [...new Set(precoMud.map((m) => m.tabela_id))];
  const nomes = new Map();
  for (let i = 0; i < tabIds.length; i += 200) {
    const { data } = await s.from('tabelas').select('id,nome').in('id', tabIds.slice(i, i + 200));
    for (const t of data || []) nomes.set(t.id, t.nome);
  }
  for (const m of precoMud) {
    const antes = new Map((m.antes || []).map((a) => [a.chave, a.valor]));
    for (const d of m.depois) {
      const [, , , faixa, acomodacao, copart] = d.chave.split('|');
      const a = Number(antes.get(d.chave)), n = Number(d.valor);
      const r = wd.addRow([new Date(m.detectado_em), grupoDe(m.operadora), nomes.get(m.tabela_id) || m.tabela_id, info.get(d.chave)?.uf || m.uf,
        info.get(d.chave)?.plano || '', rotuloFaixa(faixa), acomodacao, copart, a, n, a ? (n - a) / a : null]);
      r.getCell(1).numFmt = 'dd/mm/yyyy';
      r.getCell(9).numFmt = r.getCell(10).numFmt = '"R$" #,##0.00';
      r.getCell(11).numFmt = '0.0%';
    }
  }
  larguras(wd, [11, 16, 40, 5, 24, 10, 13, 24, 12, 12, 9]);
  return { buffer: await wb.xlsx.writeBuffer(), nome: `alteracoes-${new Date().toISOString().slice(0, 10)}.xlsx` };
}

export function aplicarFiltrosMudancas(q, { grupo, tipo, de, ate, lida }) {
  if (grupo) q = q.or(orIlike(grupo));
  if (tipo) q = q.eq('tipo', tipo);
  if (de) q = q.gte('detectado_em', `${de}T00:00:00-03:00`);
  if (ate) q = q.lte('detectado_em', `${ate}T23:59:59-03:00`);
  if (lida === 'nao') q = q.eq('lida', false);
  if (lida === 'sim') q = q.eq('lida', true);
  return q;
}
