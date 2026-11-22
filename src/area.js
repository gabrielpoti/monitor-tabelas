// Área de comercialização: em quais cidades cada tabela das operadoras monitoradas aparece.
// Varre cidade por cidade (PME, PJ, PF), guarda o ponto onde parou e continua na próxima execução.

import { db, lerTudo, gravar, getConfig, setConfig } from './db.js';
import { TIPOS_TABELA, monitorada } from './config.js';
import { tempoAcabou, log, emParalelo, estavel } from './util.js';

export async function varrerArea(cot, registrarMudanca) {
  const cidades = await lerTudo('cidades', 'id,nome,uf,uf_id', (q) => q.order('id'));
  if (!cidades.length) throw new Error('Nenhuma cidade ligada ainda — rode o modo "cidades" primeiro.');

  let cursor = Number(await getConfig('area_cursor') || 0);
  let inicioVarredura = await getConfig('area_inicio');
  if (!cursor || !inicioVarredura) {
    cursor = 0; inicioVarredura = new Date().toISOString();
    // Fotografa os planos de cada tabela: a comparação de planos é feita só no fim da varredura,
    // com a união de todas as cidades (cada cidade lista só os planos regionais dela).
    { const { error } = await db.rpc('area_iniciar_planos'); if (error) throw new Error('Fotografando planos: ' + error.message); }
    await setConfig('area_inicio', inicioVarredura);
  }
  const baseline = (await getConfig('area_baseline_ok')) !== '1'; // 1ª varredura completa não gera alertas

  const tabelasAntes = new Map((await lerTudo('tabelas', 'id,nome,operadora,planos,planos_inicio,planos_vistos,ativa,ultima_vez')).map((t) => [t.id, t]));
  // Planos vistos nesta varredura, por tabela (união de todas as cidades, guardada em planos_vistos).
  const planosVarredura = new Map();
  for (const t of tabelasAntes.values()) {
    if ((t.planos_vistos || []).length) planosVarredura.set(t.id, new Map(t.planos_vistos.map((p) => [p.id, p.nome])));
  }
  const lista = (m) => [...m.entries()].map(([pid, nome]) => ({ id: pid, nome })).sort((a, b) => a.id - b.id);
  const unirPlanos = (id, novos) => {
    if (!planosVarredura.has(id)) planosVarredura.set(id, new Map());
    const m = planosVarredura.get(id);
    for (const p of novos) m.set(p.id, p.nome);
    return lista(m);
  };
  // Durante a varredura a tabela mantém os planos da foto + os vistos (a conferência diária continua cotando todos).
  const planosEmUso = (id, vistos) => {
    const m = new Map((tabelasAntes.get(id)?.planos_inicio || tabelasAntes.get(id)?.planos || []).map((p) => [p.id, p.nome]));
    for (const p of vistos) m.set(p.id, p.nome);
    return lista(m);
  };
  const nomesCidade = new Map(cidades.map((c) => [c.id, `${c.nome}/${c.uf}`]));
  const pendentes = cidades.filter((c) => c.id > cursor);
  log(`Área: ${pendentes.length} de ${cidades.length} cidades a varrer (baseline=${baseline})`);

  const novasTabelasAvisadas = new Set();
  // Tabelas de operadora recém-incluída (descoberta parcial): a 1ª varredura completa não avisa as cidades delas.
  const silenciadas = new Set(JSON.parse((await getConfig('area_silenciar')) || '[]'));
  for (let i = 0; i < pendentes.length && !tempoAcabou(); i += 40) {
    const lote = pendentes.slice(i, i + 40);
    const agora = new Date().toISOString();
    const tabelas = new Map();
    const vinculos = [];
    const catalogo = new Map(); // todas as tabelas do cotador (inclusive operadoras não monitoradas), por UF

    const rs = await emParalelo(lote, async (c) => {
      for (const tipo of TIPOS_TABELA) {
        const itens = await cot.listarTabelas(c.uf_id, c.id, tipo);
        for (const t of itens) catalogo.set(`${t.id}|${c.uf}`, { tabela_id: t.id, uf: c.uf, nome: t.nome, operadora_id: t.operadoraId,
          operadora: t.operadora, administradora: t.administradora, tipo_tabela: tipo, ultima_vez: agora });
        for (const t of itens.filter(monitorada)) {
          tabelas.set(t.id, {
            id: t.id, nome: t.nome, operadora_id: t.operadoraId, operadora: t.operadora,
            administradora: t.administradora, tipo_tabela: tipo, uf_id: c.uf_id,
            minimo_vidas: t.minimoVidas, exige_entidade: t.exigeEntidade,
            ...(() => { const vistos = unirPlanos(t.id, (t.planos || []).map((p) => ({ id: p.id, nome: p.nome })));
              return { planos_vistos: vistos, planos: planosEmUso(t.id, vistos) }; })(),
            ativa: true, ultima_vez: agora,
          });
          vinculos.push({ tabela_id: t.id, cidade_id: c.id, ultima_vez: agora });
        }
      }
    });

    // vínculos novos (cidade passou a ter a tabela)
    const ids = [...new Set(vinculos.map((v) => v.tabela_id))];
    const existentes = new Set();
    for (const c of lote) {
      const vs = await lerTudo('tabela_cidade', 'tabela_id,cidade_id', (q) => q.eq('cidade_id', c.id));
      for (const v of vs) existentes.add(`${v.tabela_id}|${v.cidade_id}`);
    }
    const novosVinculos = vinculos.filter((v) => !existentes.has(`${v.tabela_id}|${v.cidade_id}`));

    for (const t of tabelas.values()) {
      const antes = tabelasAntes.get(t.id);
      if (!antes) {
        if (!baseline && !novasTabelasAvisadas.has(t.id)) {
          novasTabelasAvisadas.add(t.id);
          registrarMudanca({ tipo: 'tabela_nova', operadora: t.operadora, tabela_id: t.id, chave: String(t.id),
            descricao: `Tabela nova: ${t.nome} (${t.tipo_tabela}, ${t.administradora}) — ${t.planos.length} planos`, depois: t });
        }
        tabelasAntes.set(t.id, t);
      } else if (antes.ativa === false && !baseline) {
        registrarMudanca({ tipo: 'tabela_voltou', operadora: t.operadora, tabela_id: t.id, chave: String(t.id),
          descricao: `Tabela voltou a aparecer: ${t.nome}` });
        tabelasAntes.set(t.id, t);
      }
    }

    if (!baseline) {
      const porTabela = new Map();
      for (const v of novosVinculos) {
        if (novasTabelasAvisadas.has(v.tabela_id) || silenciadas.has(v.tabela_id)) continue;
        if (!porTabela.has(v.tabela_id)) porTabela.set(v.tabela_id, []);
        porTabela.get(v.tabela_id).push(nomesCidade.get(v.cidade_id));
      }
      for (const [tid, cs] of porTabela) {
        const t = tabelas.get(tid);
        registrarMudanca({ tipo: 'area_entrou', operadora: t.operadora, tabela_id: tid, chave: `${tid}|+`,
          descricao: `${t.nome}: passou a valer em ${cs.length} cidade(s): ${cs.slice(0, 8).join(', ')}${cs.length > 8 ? '…' : ''}`, depois: cs });
      }
    }

    if (tabelas.size) await gravar('tabelas', [...tabelas.values()], 'id');
    if (catalogo.size) await gravar('catalogo_tabelas', [...catalogo.values()], 'tabela_id,uf');
    if (vinculos.length) await gravar('tabela_cidade', dedup(vinculos), 'tabela_id,cidade_id');
    // Avança só até a última cidade contínua que respondeu; se alguma falhou, para e retoma dali.
    const primeiraFalha = rs.findIndex((r) => r?.__erro);
    if (primeiraFalha === 0) { log('Área: falha na 1ª cidade do lote; retoma na próxima execução'); break; }
    cursor = lote[(primeiraFalha === -1 ? lote.length : primeiraFalha) - 1].id;
    await setConfig('area_cursor', cursor);
    if (primeiraFalha !== -1) { log('Área: falha no lote; retoma na próxima execução'); break; }
    if ((i / 40) % 10 === 0) log(`Área: ${i + lote.length}/${pendentes.length} cidades, ${cot.chamadas} chamadas`);
  }

  const completa = cursor >= cidades[cidades.length - 1].id;
  if (!completa) return { completa: false, cursor };

  // Varredura completa: o que não apareceu desde o início dela saiu da área.
  const sumiram = await lerTudo('tabela_cidade', 'tabela_id,cidade_id', (q) => q.lt('ultima_vez', inicioVarredura));
  const tabelasAgora = await lerTudo('tabelas', 'id,nome,operadora,ativa,ultima_vez');
  const inativas = tabelasAgora.filter((t) => t.ativa && t.ultima_vez < inicioVarredura);

  // Planos: compara a união vista nesta varredura com a foto do início.
  const comPlanos = await lerTudo('tabelas', 'id,nome,operadora,planos_inicio,planos_vistos,ativa,ultima_vez', (q) => q.eq('ativa', true).gte('ultima_vez', inicioVarredura));
  const planosFinais = [];
  for (const t of comPlanos) {
    const vistos = t.planos_vistos || [];
    if (!vistos.length) continue;
    planosFinais.push({ id: t.id, planos: vistos });
    if (baseline || !t.planos_inicio) continue;
    const a = new Map(t.planos_inicio.map((p) => [p.id, p.nome])), d = new Map(vistos.map((p) => [p.id, p.nome]));
    const entrou = vistos.filter((p) => !a.has(p.id)), saiu = t.planos_inicio.filter((p) => !d.has(p.id));
    if (entrou.length || saiu.length) {
      registrarMudanca({ tipo: 'planos', operadora: t.operadora, tabela_id: t.id, chave: String(t.id),
        descricao: `${t.nome}: ${entrou.length ? 'entrou ' + entrou.map((p) => p.nome).join(', ') : ''}${entrou.length && saiu.length ? '; ' : ''}${saiu.length ? 'saiu ' + saiu.map((p) => p.nome).join(', ') : ''}`,
        antes: { planos: t.planos_inicio, saiu }, depois: { planos: vistos, entrou } });
    }
  }
  if (planosFinais.length) await gravar('tabelas', planosFinais, 'id');

  if (!baseline) {
    const nomesTab = new Map(tabelasAgora.map((t) => [t.id, t]));
    const porTabela = new Map();
    for (const v of sumiram) {
      if (inativas.some((t) => t.id === v.tabela_id)) continue;
      if (!porTabela.has(v.tabela_id)) porTabela.set(v.tabela_id, []);
      porTabela.get(v.tabela_id).push(nomesCidade.get(v.cidade_id));
    }
    for (const [tid, cs] of porTabela) {
      const t = nomesTab.get(tid);
      registrarMudanca({ tipo: 'area_saiu', operadora: t?.operadora, tabela_id: tid, chave: `${tid}|-`,
        descricao: `${t?.nome}: deixou de aparecer em ${cs.length} cidade(s): ${cs.slice(0, 8).join(', ')}${cs.length > 8 ? '…' : ''}`, antes: cs });
    }
    for (const t of inativas) {
      registrarMudanca({ tipo: 'tabela_removida', operadora: t.operadora, tabela_id: t.id, chave: String(t.id),
        descricao: `Tabela sumiu do cotador: ${t.nome}` });
    }
  }
  if (inativas.length) await gravar('tabelas', inativas.map((t) => ({ id: t.id, ativa: false })), 'id');
  if (sumiram.length) {
    const { error } = await db.from('tabela_cidade').delete().lt('ultima_vez', inicioVarredura);
    if (error) throw new Error('Limpando área antiga: ' + error.message);
  }
  await setConfig('area_cursor', 0);
  await setConfig('area_inicio', null);
  await setConfig('area_silenciar', null);
  await setConfig('area_baseline_ok', '1');
  return { completa: true, tabelasAtivas: tabelasAgora.length - inativas.length, vinculosRemovidos: sumiram.length, tabelasRemovidas: inativas.length };
}

const dedup = (vs) => [...new Map(vs.map((v) => [`${v.tabela_id}|${v.cidade_id}`, v])).values()];
