// Conferência diária: preços por faixa etária, coparticipação e carência de cada tabela ativa, por UF.

import { db, lerTudo, gravar } from './db.js';
import { FAIXAS } from './config.js';
import { tempoAcabou, log, emParalelo, agrupar, estavel, brl, pct } from './util.js';

const chavePreco = (x) => [x.tabela_id, x.plano_id, x.uf_id, x.faixa, x.acomodacao, x.coparticipacao, x.taxa_adesao ?? ''].join('|');

export async function conferirPrecos(cot, registrarMudanca) {
  const tabelas = new Map((await lerTudo('tabelas', '*', (q) => q.eq('ativa', true))).map((t) => [t.id, t]));
  const ufs = (await lerTudo('tabela_uf')).filter((x) => tabelas.has(x.tabela_id));
  if (!ufs.length) { log('Área ainda não varrida — nada a conferir.'); return { aguardandoArea: true }; }

  const antes = new Map((await lerTudo('precos')).map((p) => [p.chave, p]));
  const tabelasComPreco = new Set([...antes.values()].map((p) => `${p.tabela_id}|${p.uf_id}`));

  // Lotes de até 20 planos da mesma UF e tipo de tabela.
  const lotes = [];
  for (const [k, grupo] of agrupar(ufs, (x) => `${x.uf_id}|${tabelas.get(x.tabela_id).tipo_tabela}`)) {
    const [ufId, tipo] = k.split('|');
    const planos = grupo.flatMap((g) => (tabelas.get(g.tabela_id).planos || []).map((p) => ({ ...p, tabela_id: g.tabela_id, uf: g.uf })));
    for (let i = 0; i < planos.length; i += 20) lotes.push({ ufId: Number(ufId), tipo, planos: planos.slice(i, i + 20) });
  }
  log(`Preços: ${ufs.length} tabela×UF, ${lotes.length} lotes × ${FAIXAS.length} faixas`);

  const agora = new Date().toISOString();
  const novos = new Map();
  const consultadas = new Set(); // tabela|uf que responderam
  const semPreco = new Set();
  let interrompido = false;
  let lotesComFalha = 0, ultimoErro = null;

  for (let i = 0; i < lotes.length; i += 10) {
    if (tempoAcabou()) { interrompido = true; break; }
    const rs = await emParalelo(lotes.slice(i, i + 10), async (lote) => {
      const planosLote = new Set(lote.planos.map((p) => p.id));
      // Só aproveita o lote se todas as faixas responderem; se uma falhar, mantém os preços de ontem.
      const respostas = [];
      for (const [faixa, idade] of FAIXAS) {
        respostas.push([faixa, await cot.opcoesPreco(lote.ufId, lote.tipo, [...planosLote], idade)]);
      }
      for (const [faixa, itens] of respostas) {
        for (const it of itens) {
          const t = tabelas.get(it.tabelaId);
          if (!t) continue;
          const linha = {
            tabela_id: it.tabelaId, plano_id: it.planoId, uf_id: lote.ufId, faixa,
            acomodacao: it.acomodacao || '', coparticipacao: it.coparticipacao || '', taxa_adesao: it.taxaAdesao ?? null,
            plano: it.plano, operadora_id: it.operadoraId, valor: it.valorTotal, valor_bruto: it.valorBruto,
            desconto: it.desconto ?? (Number(it.valorBruto) > Number(it.valorTotal) ? Math.round((1 - it.valorTotal / it.valorBruto) * 1000) / 10 : null), encerrada: !!it.encerrada, encerrada_em: it.encerradaEm, novo_preco_em: it.novoPrecoEm,
            uf: lote.planos[0].uf, tipo_tabela: lote.tipo, administradora: t.administradora, atualizado_em: agora,
          };
          linha.chave = chavePreco(linha);
          novos.set(linha.chave, linha);
          consultadas.add(`${it.tabelaId}|${lote.ufId}`);
        }
      }
    });
    for (const r of rs) if (r?.__erro) { lotesComFalha++; ultimoErro = r.__erro.message; }
    if ((i / 10) % 10 === 0) log(`Preços:${Math.min(i + 10, lotes.length)}/${lotes.length} lotes, ${cot.chamadas} chamadas`);
  }
  for (const u of ufs) if (!consultadas.has(`${u.tabela_id}|${u.uf_id}`)) semPreco.add(`${tabelas.get(u.tabela_id).nome} (${u.uf})`);

  // ----- comparação -----
  const porTabelaUf = agrupar([...novos.values()], (p) => `${p.tabela_id}|${p.uf_id}`);
  for (const [k, linhas] of porTabelaUf) {
    if (!tabelasComPreco.has(k)) continue; // primeira vez desta tabela/UF: só registra
    const t = tabelas.get(linhas[0].tabela_id);
    const nome = `${t.nome} (${linhas[0].uf})`;
    const alteradas = [], agendadas = [], encerradas = [], descontos = [];
    for (const n of linhas) {
      const a = antes.get(n.chave);
      if (!a) continue;
      const cheioA = Number(a.valor_bruto ?? a.valor), cheioN = Number(n.valor_bruto ?? n.valor);
      if (cheioA !== cheioN) alteradas.push({ a, n, p: pct(cheioA, cheioN), cheioA, cheioN });
      if (n.novo_preco_em && n.novo_preco_em !== a.novo_preco_em) agendadas.push(n);
      if (n.encerrada && !a.encerrada) encerradas.push(n);
      if (String(a.desconto ?? '') !== String(n.desconto ?? '')) descontos.push({ a, n });
    }
    const base = { operadora: t.operadora, tabela_id: t.id, uf: linhas[0].uf };
    if (alteradas.length) {
      const media = alteradas.reduce((s, x) => s + (x.p || 0), 0) / alteradas.length;
      const ex = alteradas[0];
      registrarMudanca({ ...base, tipo: 'preco', chave: k,
        descricao: `${nome}: ${alteradas.length} preço(s) de tabela mudaram, média ${media >= 0 ? '+' : ''}${media.toFixed(1).replace('.', ',')}% — ex.: ${ex.n.plano} ${ex.n.acomodacao} ${ex.n.faixa}: R$ ${brl(ex.cheioA)} → R$ ${brl(ex.cheioN)}`,
        antes: alteradas.map((x) => ({ chave: x.a.chave, valor: x.cheioA })), depois: alteradas.map((x) => ({ chave: x.n.chave, valor: x.cheioN })) });
    }
    if (agendadas.length) {
      const datas = [...new Set(agendadas.map((x) => x.novo_preco_em.slice(0, 10)))].map((d) => d.split('-').reverse().join('/'));
      registrarMudanca({ ...base, tipo: 'novo_preco_agendado', chave: k,
        descricao: `${nome}: preço novo agendado para ${datas.join(', ')} (${agendadas.length} combinações)` });
    }
    if (encerradas.length) {
      registrarMudanca({ ...base, tipo: 'encerrada', chave: k,
        descricao: `${nome}: ${encerradas.length} combinação(ões) marcadas como encerradas (${[...new Set(encerradas.map((x) => x.plano))].join(', ')})` });
    }
    if (descontos.length) {
      const ex = descontos[0];
      registrarMudanca({ ...base, tipo: 'desconto', chave: k,
        descricao: `${nome}: desconto/campanha mudou em ${descontos.length} combinação(ões) — ex.: ${ex.n.plano} ${ex.n.acomodacao} ${ex.n.faixa}: ${ex.a.desconto != null ? ex.a.desconto + '%' : 'sem desconto'} → ${ex.n.desconto != null ? ex.n.desconto + '%' : 'sem desconto'} (valor com desconto R$ ${brl(ex.n.valor)})` });
    }
    // combinações que existiam e sumiram (só se a tabela respondeu hoje)
    const sumiram = [...antes.values()].filter((a) => `${a.tabela_id}|${a.uf_id}` === k && !novos.has(a.chave));
    if (sumiram.length) {
      registrarMudanca({ ...base, tipo: 'combinacao_removida', chave: k,
        descricao: `${nome}: ${sumiram.length} combinação(ões) de preço saíram (${[...new Set(sumiram.map((x) => `${x.plano} ${x.acomodacao} ${x.coparticipacao}`))].slice(0, 4).join('; ')})` });
    }
  }

  await gravar('precos', [...novos.values()], 'chave');
  // Histórico: grava o valor do dia sempre que é novo ou mudou (alimenta os gráficos do site).
  const historico = [...novos.values()]
    .filter((n) => { const a = antes.get(n.chave); return !a || Number(a.valor_bruto ?? a.valor) !== Number(n.valor_bruto ?? n.valor); })
    .map((n) => ({ chave: n.chave, tabela_id: n.tabela_id, plano_id: n.plano_id, uf_id: n.uf_id, faixa: n.faixa,
      acomodacao: n.acomodacao, coparticipacao: n.coparticipacao, valor: n.valor_bruto ?? n.valor }));
  if (historico.length) await gravar('precos_historico', historico, 'chave,data');
  // remove só combinações das tabela/UF que responderam hoje e não trouxeram mais a combinação
  const remover = [...antes.values()].filter((a) => consultadas.has(`${a.tabela_id}|${a.uf_id}`) && !novos.has(a.chave)).map((a) => a.chave);
  for (let i = 0; i < remover.length; i += 200) await db.from('precos').delete().in('chave', remover.slice(i, i + 200));

  return { precos: novos.size, tabelasUf: ufs.length, semPreco: [...semPreco], interrompido, lotesComFalha, ultimoErro };
}

export async function conferirRegras(cot, registrarMudanca) {
  const tabelas = new Map((await lerTudo('tabelas', '*', (q) => q.eq('ativa', true))).map((t) => [t.id, t]));
  const ufs = new Map((await lerTudo('tabela_uf')).map((x) => [`${x.tabela_id}|${x.uf_id}`, x]));
  const precos = await lerTudo('precos', 'tabela_id,plano_id,uf_id,tipo_tabela,coparticipacao,operadora_id');

  const produtosCopart = new Map(), produtosCarencia = new Map();
  for (const p of precos) {
    const t = tabelas.get(p.tabela_id); const u = ufs.get(`${p.tabela_id}|${p.uf_id}`);
    if (!t || !u) continue;
    const prod = { operadoraId: p.operadora_id, administradora: t.administradora || 'direto', tabelaId: p.tabela_id,
      planoId: p.plano_id, ufId: p.uf_id, cidadeId: u.cidade_exemplo, tipoTabela: p.tipo_tabela || t.tipo_tabela,
      coparticipacao: p.coparticipacao || undefined };
    produtosCopart.set(`${p.tabela_id}|${p.plano_id}|${p.uf_id}|${p.coparticipacao}`, { ...prod, _uf: u.uf, _nome: t.nome, _op: t.operadora });
    produtosCarencia.set(`${p.tabela_id}|${p.plano_id}|${p.uf_id}`, { ...prod, _uf: u.uf, _nome: t.nome, _op: t.operadora });
  }
  log(`Regras: ${produtosCopart.size} produtos de coparticipação, ${produtosCarencia.size} de carência`);

  const res = {};
  for (const [tipo, mapa, fn, tabelaDb] of [
    ['coparticipacao', produtosCopart, (ps) => cot.coparticipacao(ps), 'coparticipacao'],
    ['carencia', produtosCarencia, (ps) => cot.carencia(ps), 'carencia'],
  ]) {
    if (tempoAcabou()) { res[tipo] = 'pulado (tempo)'; continue; }
    const antes = new Map((await lerTudo(tabelaDb)).map((x) => [x.chave, x]));
    const entradas = [...mapa.entries()];
    const linhas = [];
    const lotes = [];
    for (let i = 0; i < entradas.length; i += 10) lotes.push(entradas.slice(i, i + 10));
    for (let i = 0; i < lotes.length && !tempoAcabou(); i += 10) {
      await emParalelo(lotes.slice(i, i + 10), async (lote) => {
        const d = await fn(lote.map(([, p]) => limpar(p)));
        lote.forEach(([chave, p], idx) => {
          const tabs = (d?.tabelas || []).filter((x) => x.produtoIndice === idx);
          const v = tabs[0];
          const base = { chave, tabela_id: p.tabelaId, plano_id: p.planoId, uf_id: p.ufId, coparticipacao: p.coparticipacao || '',
            nome: v?.nome ?? null, vigencia_inicio: v?.vigenciaInicio ?? null, vigencia_fim: v?.vigenciaFim ?? null,
            itens: v?.itens ?? null, atualizado_em: new Date().toISOString(), _p: p };
          if (tipo === 'coparticipacao') Object.assign(base, { copart_tab_id: v?.copartTabId ?? null, descricao: v?.descricao ?? null });
          else Object.assign(base, { carencia_id: v?.carenciaId ?? null, regras_aceitacao: v?.regrasAceitacao ?? null });
          linhas.push(base);
        });
      });
    }
    // comparação agrupada por tabela/UF
    const mudou = linhas.filter((l) => {
      const a = antes.get(l.chave);
      if (!a) return false;
      const idA = tipo === 'coparticipacao' ? a.copart_tab_id : a.carencia_id;
      const idN = tipo === 'coparticipacao' ? l.copart_tab_id : l.carencia_id;
      return idA !== idN || estavel(a.itens) !== estavel(l.itens) || a.vigencia_fim !== l.vigencia_fim
        || (tipo === 'carencia' && estavel(a.regras_aceitacao) !== estavel(l.regras_aceitacao));
    });
    for (const [k, ls] of agrupar(mudou, (l) => `${l.tabela_id}|${l.uf_id}`)) {
      const p = ls[0]._p; const a = antes.get(ls[0].chave);
      const rotulo = tipo === 'coparticipacao' ? 'Coparticipação' : 'Carência';
      registrarMudanca({ tipo, operadora: p._op, tabela_id: p.tabelaId, uf: p._uf, chave: k,
        descricao: `${rotulo} mudou — ${p._nome} (${p._uf}): ${ls.length} plano(s). ${resumoItens(a, ls[0])}`,
        antes: a, depois: { ...ls[0], _p: undefined } });
    }
    await gravar(tabelaDb, linhas.map(({ _p, ...l }) => l), 'chave');
    res[tipo] = linhas.length;
  }
  return res;
}

const limpar = (p) => Object.fromEntries(Object.entries(p).filter(([k, v]) => !k.startsWith('_') && v !== undefined));

function resumoItens(a, n) {
  if (!a?.itens || !n?.itens) return n?.itens ? 'Passou a ter tabela vigente.' : 'Ficou sem tabela vigente.';
  const nomeItem = (x) => x.item || x.text_carencia?.slice(0, 40);
  const valor = (x) => x.text_valor_copart ?? x.percent_text ?? x.tempo;
  const mA = new Map(a.itens.map((x) => [nomeItem(x), valor(x)]));
  const dif = n.itens.filter((x) => mA.get(nomeItem(x)) !== valor(x)).slice(0, 3)
    .map((x) => `${nomeItem(x)}: ${mA.get(nomeItem(x)) ?? 'novo'} → ${valor(x)}`);
  return dif.length ? dif.join('; ') : 'Mudou a vigência ou a tabela de referência.';
}
