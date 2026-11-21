// Gera a planilha de rede credenciada (mesmo formato da aba Rede do site) e grava em saida/.
// Uso: GRUPO=Unimed node src/exportar-rede.js   (GRUPO vazio = todas as operadoras)
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { mkdirSync } from 'node:fs';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const TIPOS_LOCAL = {
  hosp: 'Hospital', ps: 'Pronto-socorro', lab: 'Laboratório', cli: 'Clínica', img: 'Imagem / diagnóstico',
  cons: 'Consultório', odonto: 'Odontologia', mat: 'Maternidade', terapia: 'Terapias', outros: 'Outros',
};
const tipoLocal = (t) => TIPOS_LOCAL[t] || t || '—';
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const grupo = (process.env.GRUPO || '').trim();
const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const linhas = [];
for (let de = 0; ; de += 1000) {
  let q = db.from('v_rede').select('grupo,operadora,administradora,tabela,tipo_tabela,plano,uf,cidade,local,tipo,cobertura,atualizado_em')
    .order('uf').order('cidade').order('grupo').order('plano').order('tipo').order('local').range(de, de + 999);
  if (grupo) q = q.eq('grupo', grupo);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  linhas.push(...data);
  if (data.length < 1000) break;
}
console.log(`${linhas.length} linhas de rede`);

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

const wb = new ExcelJS.Workbook();
wb.creator = 'Monitor de Tabelas';

const ws = wb.addWorksheet('Rede');
cabecalho(ws, ['Operadora', 'Administradora', 'Tabela', 'Tipo de tabela', 'Plano', 'UF', 'Cidade', 'Local de atendimento', 'Tipo de atendimento', 'Cobertura (como no cadastro)', 'Atualizado em'],
  [16, 14, 38, 9, 26, 5, 24, 46, 18, 22, 12]);
for (const l of linhas) {
  const r = ws.addRow([l.grupo, l.administradora, l.tabela, l.tipo_tabela, l.plano, l.uf, l.cidade, l.local, tipoLocal(l.tipo), l.cobertura, l.atualizado_em ? new Date(l.atualizado_em) : null]);
  r.getCell(11).numFmt = 'dd/mm/yyyy';
}

const tiposVistos = [...new Set(linhas.map((l) => l.tipo))].sort();
const resumo = new Map();
for (const l of linhas) {
  const k = `${l.grupo}|${l.administradora}|${l.tabela}|${l.plano}|${l.uf}|${l.cidade}`;
  if (!resumo.has(k)) resumo.set(k, { ...l, total: 0, porTipo: {} });
  const x = resumo.get(k); x.total++; x.porTipo[l.tipo] = (x.porTipo[l.tipo] || 0) + 1;
}
const wr = wb.addWorksheet('Resumo por plano');
cabecalho(wr, ['Operadora', 'Administradora', 'Tabela', 'Tipo de tabela', 'Plano', 'UF', 'Cidade', 'Total de locais', ...tiposVistos.map(tipoLocal)],
  [16, 14, 38, 9, 26, 5, 24, 10, ...tiposVistos.map(() => 13)]);
for (const x of [...resumo.values()]) {
  wr.addRow([x.grupo, x.administradora, x.tabela, x.tipo_tabela, x.plano, x.uf, x.cidade, x.total, ...tiposVistos.map((t) => x.porTipo[t] || 0)]);
}

const porLocal = new Map();
for (const l of linhas) {
  const k = `${l.uf}|${l.cidade}|${l.local}|${l.tipo}`;
  if (!porLocal.has(k)) porLocal.set(k, { uf: l.uf, cidade: l.cidade, local: l.local, tipo: l.tipo, ops: new Set(), planos: new Set() });
  const x = porLocal.get(k); x.ops.add(l.operadora || l.grupo); x.planos.add(`${l.plano} (${l.tabela})`);
}
const wl = wb.addWorksheet('Por local');
cabecalho(wl, ['UF', 'Cidade', 'Local de atendimento', 'Tipo de atendimento', 'Operadoras', 'Qtde. de planos', 'Planos que atendem'], [5, 24, 46, 18, 30, 10, 120]);
for (const x of [...porLocal.values()]) {
  wl.addRow([x.uf, x.cidade, x.local, tipoLocal(x.tipo), [...x.ops].sort().join(', '), x.planos.size, [...x.planos].sort().join(' | ')]);
}
wl.getColumn(7).alignment = { wrapText: true, vertical: 'top' };

mkdirSync('saida', { recursive: true });
const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(/\//g, '-');
const arq = `saida/rede-${grupo ? slug(grupo) : 'todas'}-${hoje}.xlsx`;
await wb.xlsx.writeFile(arq);
console.log(`Gravado ${arq}`);
