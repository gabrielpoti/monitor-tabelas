import 'server-only';
import ExcelJS from 'exceljs';
import { db, tudo } from './db';
import { slug, tipoLocal, dataBR } from './util';

export const LIMITE_LINHAS = 250_000;

// Monta a consulta da view v_rede com os filtros da página.
export function consultaRede({ grupo, uf, cidade, tipo, admin, plano, q, tipoTabela }, colunas = '*', opcoes) {
  let c = db().from('v_rede').select(colunas, opcoes);
  if (grupo) c = c.eq('grupo', grupo);
  if (uf) c = c.eq('uf', uf);
  if (cidade) c = c.ilike('cidade', cidade.trim());
  if (tipo) c = c.eq('tipo', tipo);
  if (admin) c = c.eq('administradora', admin);
  if (tipoTabela) c = c.eq('tipo_tabela', tipoTabela);
  if (plano) c = c.ilike('plano', `%${plano.trim()}%`);
  if (q) c = c.ilike('local', `%${q.trim()}%`);
  return c;
}

export async function contarRede(f) {
  const { count, error } = await consultaRede(f, 'local', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count || 0;
}

function cabecalho(ws, colunas, larguras) {
  const r = ws.getRow(1);
  colunas.forEach((c, i) => { r.getCell(i + 1).value = c; ws.getColumn(i + 1).width = larguras[i]; });
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B6BCB' } };
  r.alignment = { vertical: 'middle', wrapText: true };
  r.height = 28;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
}

export async function planilhaRede(f) {
  const linhas = await tudo(() => consultaRede(f,
    'grupo,operadora,administradora,tabela,tipo_tabela,plano,uf,cidade,local,tipo,cobertura,atualizado_em')
    .order('uf').order('cidade').order('grupo').order('plano').order('tipo').order('local'));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Monitor de Tabelas';

  // 1) Rede: uma linha por local × plano
  const ws = wb.addWorksheet('Rede');
  cabecalho(ws, ['Operadora', 'Administradora', 'Tabela', 'Tipo de tabela', 'Plano', 'UF', 'Cidade', 'Local de atendimento', 'Tipo de atendimento', 'Cobertura (como no cadastro)', 'Atualizado em'],
    [16, 14, 38, 9, 26, 5, 24, 46, 18, 22, 12]);
  for (const l of linhas) {
    const r = ws.addRow([l.operadora || l.grupo, l.administradora, l.tabela, l.tipo_tabela, l.plano, l.uf, l.cidade, l.local, tipoLocal(l.tipo), l.cobertura, l.atualizado_em ? new Date(l.atualizado_em) : null]);
    r.getCell(11).numFmt = 'dd/mm/yyyy';
  }
  if (!linhas.length) ws.addRow(['Nenhum local encontrado com esses filtros (ou a rede desta região ainda não foi coletada).']);

  // 2) Resumo por plano: tamanho da rede de cada plano em cada cidade
  const tiposVistos = [...new Set(linhas.map((l) => l.tipo))].sort();
  const resumo = new Map();
  for (const l of linhas) {
    const k = `${l.grupo}|${l.tabela}|${l.plano}|${l.uf}|${l.cidade}`;
    if (!resumo.has(k)) resumo.set(k, { ...l, total: 0, porTipo: {} });
    const x = resumo.get(k); x.total++; x.porTipo[l.tipo] = (x.porTipo[l.tipo] || 0) + 1;
  }
  const wr = wb.addWorksheet('Resumo por plano');
  cabecalho(wr, ['Operadora', 'Administradora', 'Tabela', 'Tipo de tabela', 'Plano', 'UF', 'Cidade', 'Total de locais', ...tiposVistos.map(tipoLocal)],
    [16, 14, 38, 9, 26, 5, 24, 10, ...tiposVistos.map(() => 13)]);
  for (const x of [...resumo.values()].sort((a, b) => `${a.uf}${a.cidade}${a.grupo}${a.plano}`.localeCompare(`${b.uf}${b.cidade}${b.grupo}${b.plano}`))) {
    wr.addRow([x.operadora || x.grupo, x.administradora, x.tabela, x.tipo_tabela, x.plano, x.uf, x.cidade, x.total, ...tiposVistos.map((t) => x.porTipo[t] || 0)]);
  }

  // 3) Por local: cada hospital/clínica e todos os planos que atendem nele
  const porLocal = new Map();
  for (const l of linhas) {
    const k = `${l.uf}|${l.cidade}|${l.local}|${l.tipo}`;
    if (!porLocal.has(k)) porLocal.set(k, { uf: l.uf, cidade: l.cidade, local: l.local, tipo: l.tipo, ops: new Set(), planos: new Set() });
    const x = porLocal.get(k); x.ops.add(l.grupo); x.planos.add(`${l.grupo} · ${l.plano} (${l.tabela})`);
  }
  const wl = wb.addWorksheet('Por local');
  cabecalho(wl, ['UF', 'Cidade', 'Local de atendimento', 'Tipo de atendimento', 'Operadoras', 'Qtde. de planos', 'Planos que atendem'], [5, 24, 46, 18, 30, 10, 120]);
  for (const x of [...porLocal.values()].sort((a, b) => `${a.uf}${a.cidade}${a.local}`.localeCompare(`${b.uf}${b.cidade}${b.local}`))) {
    wl.addRow([x.uf, x.cidade, x.local, tipoLocal(x.tipo), [...x.ops].sort().join(', '), x.planos.size, [...x.planos].sort().join(' | ')]);
  }
  wl.getColumn(7).alignment = { wrapText: true, vertical: 'top' };

  const partes = ['rede', f.grupo ? slug(f.grupo) : 'todas', f.cidade ? slug(f.cidade) : null, f.uf ? f.uf.toLowerCase() : null, f.tipo || null].filter(Boolean);
  return { buffer: await wb.xlsx.writeBuffer(), nome: `${partes.join('-')}-${dataBR(new Date()).replace(/\//g, '-')}.xlsx` };
}
