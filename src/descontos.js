// Desconto por quantidade de vidas (ex.: desconto família da Hapvida).
// Cota cada plano com várias quantidades de pessoas e compara o valor cheio com o valor com desconto.
// Roda uma vez por semana.

import { lerTudo, gravar } from './db.js';
import { tempoAcabou, log, emParalelo, agrupar, doGrupo } from './util.js';

const QUANTIDADES = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30];
const IDADE = 31; // faixa 29 a 33 como referência

const pctDe = (total, bruto) => (bruto > 0 && total < bruto ? Math.round((1 - total / bruto) * 1000) / 10 : 0);
const fmtPct = (p) => (p ? `${String(p).replace('.', ',')}%` : 'sem desconto');

export function montarFaixas(regra) {
  const pontos = [...regra].sort((a, b) => a.vidas - b.vidas);
  const faixas = [];
  for (const p of pontos) {
    const ult = faixas[faixas.length - 1];
    if (ult && ult.pct === p.pct) ult.ate = p.vidas;
    else faixas.push({ de: p.vidas, ate: p.vidas, pct: p.pct });
  }
  if (faixas.length) faixas[faixas.length - 1].ate = null; // "ou mais" (testado até a maior quantidade)
  return faixas;
}

export function textoFaixas(faixas) {
  if (!faixas.length) return '';
  if (faixas.every((f) => !f.pct)) return 'Sem desconto por quantidade';
  if (faixas.length === 1) return `${fmtPct(faixas[0].pct)} em qualquer quantidade (campanha da tabela)`;
  return faixas.map((f) => {
    const rot = f.ate === null ? `${f.de} ou mais` : f.de === f.ate ? `${f.de}` : `${f.de} a ${f.ate}`;
    return `${rot}: ${fmtPct(f.pct)}`;
  }).join(' · ');
}

export async function conferirDescontos(cot, registrarMudanca, { grupo } = {}) {
  const tabelas = new Map((await lerTudo('tabelas', '*', (q) => q.eq('ativa', true))).filter(doGrupo(grupo)).map((t) => [t.id, t]));
  const ufs = (await lerTudo('tabela_uf')).filter((x) => tabelas.has(x.tabela_id));
  if (!ufs.length) return { aguardandoArea: true };
  const antes = new Map((await lerTudo('descontos', 'chave,texto,tabela_id,uf')).map((d) => [d.chave, d]));

  const lotes = [];
  for (const [k, grupo] of agrupar(ufs, (x) => `${x.uf_id}|${tabelas.get(x.tabela_id).tipo_tabela}`)) {
    const [ufId, tipo] = k.split('|');
    const planos = grupo.flatMap((g) => (tabelas.get(g.tabela_id).planos || []).map((p) => ({ ...p, tabela_id: g.tabela_id, uf: g.uf })));
    for (let i = 0; i < planos.length; i += 20) {
      const pl = planos.slice(i, i + 20);
      const minimo = Math.max(1, Math.min(...pl.map((p) => tabelas.get(p.tabela_id).minimo_vidas || 1)));
      lotes.push({ ufId: Number(ufId), uf: pl[0].uf, tipo, planos: pl, qtds: QUANTIDADES.filter((q) => q >= minimo) });
    }
  }
  log(`Descontos: ${lotes.length} lotes × até ${QUANTIDADES.length} quantidades`);

  const pontos = new Map(); // chave -> {info, regra: []}
  let lotesComFalha = 0;
  for (let i = 0; i < lotes.length; i += 10) {
    if (tempoAcabou()) break;
    const rs = await emParalelo(lotes.slice(i, i + 10), async (lote) => {
      const local = [];
      for (const vidas of lote.qtds) {
        const itens = await cot.opcoesPreco(lote.ufId, lote.tipo, lote.planos.map((p) => p.id), IDADE, vidas);
        for (const it of itens) local.push({ it, vidas });
      }
      // só aproveita se todas as quantidades responderam
      for (const { it, vidas } of local) {
        if (!tabelas.has(it.tabelaId)) continue;
        const chave = [it.tabelaId, it.planoId, lote.ufId, it.acomodacao || '', it.coparticipacao || ''].join('|');
        if (!pontos.has(chave)) pontos.set(chave, { chave, tabela_id: it.tabelaId, plano_id: it.planoId, uf_id: lote.ufId, uf: lote.uf,
          plano: it.plano, acomodacao: it.acomodacao || '', coparticipacao: it.coparticipacao || '', regra: [] });
        pontos.get(chave).regra.push({ vidas, pct: pctDe(Number(it.valorTotal), Number(it.valorBruto)),
          total: Number(it.valorTotal), bruto: Number(it.valorBruto) });
      }
    });
    lotesComFalha += rs.filter((r) => r?.__erro).length;
    if ((i / 10) % 10 === 0) log(`Descontos: ${Math.min(i + 10, lotes.length)}/${lotes.length} lotes, ${cot.chamadas} chamadas`);
  }

  const agora = new Date().toISOString();
  const linhas = [...pontos.values()].map((p) => {
    const faixas = montarFaixas(p.regra);
    const maior = Math.max(0, ...p.regra.map((r) => r.pct));
    return { ...p, faixas, texto: textoFaixas(faixas), tem_desconto: maior > 0, maior_pct: maior, atualizado_em: agora };
  });

  // alertas agrupados por tabela/UF
  const mudaram = linhas.filter((l) => antes.has(l.chave) && antes.get(l.chave).texto !== l.texto);
  for (const [, ls] of agrupar(mudaram, (l) => `${l.tabela_id}|${l.uf_id}`)) {
    const t = tabelas.get(ls[0].tabela_id);
    const ex = ls[0];
    registrarMudanca({ tipo: 'desconto_vidas', operadora: t.operadora, tabela_id: t.id, uf: ex.uf, chave: `${t.id}|${ex.uf_id}`,
      descricao: `Desconto por quantidade mudou — ${t.nome} (${ex.uf}), ${ls.length} combinação(ões). Ex.: ${ex.plano} ${ex.acomodacao}: antes "${antes.get(ex.chave).texto}", agora "${ex.texto}"`,
      antes: ls.map((l) => ({ chave: l.chave, texto: antes.get(l.chave).texto })), depois: ls.map((l) => ({ chave: l.chave, texto: l.texto })) });
  }

  await gravar('descontos', linhas, 'chave');
  return { combinacoes: linhas.length, comDesconto: linhas.filter((l) => l.tem_desconto).length, mudaram: mudaram.length, lotesComFalha };
}
