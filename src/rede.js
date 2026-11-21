// Rede credenciada (hospitais, laboratórios, clínicas…) de cada plano em cada cidade onde a tabela é vendida.
// Ciclo de 90 dias: cada execução avança um pedaço e guarda o ponto; quando termina, só recomeça 90 dias
// depois do início do ciclo anterior.

import { db, lerTudo, gravar, getConfig, setConfig } from './db.js';
import { tempoAcabou, log, emParalelo, agrupar, doGrupo } from './util.js';

const CICLO_DIAS = Number(process.env.REDE_CICLO_DIAS || 90);
const UFS_PRIORITARIAS = (process.env.REDE_UFS_PRIORITARIAS || 'CE,SP,RJ').split(',').map((s) => s.trim().toUpperCase());
const TIPOS_DIVIDIR =['hosp', 'ps', 'lab', 'cli', 'img', 'cons', 'odonto', 'outros'];

export async function varrerRede(cot, registrarMudanca, { grupo } = {}) {
  // Modo prioridade (uma operadora): percorre todas as cidades dela com um ponto de parada próprio,
  // sem mexer no ciclo geral de 90 dias.
  const prio = !!grupo;
  const chaveCursor = prio ? `rede_prio_${grupo.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_cursor` : 'rede_cursor';
  let inicio = null;
  if (!prio) {
    if ((await getConfig('area_baseline_ok')) !== '1') {
      log('Rede: aguardando a 1ª varredura completa da área.');
      return { aguardandoArea: true };
    }
    inicio = await getConfig('rede_inicio');
    const ultimoInicio = await getConfig('rede_ultimo_inicio');
    if (!inicio) {
      if (ultimoInicio && Date.now() - new Date(ultimoInicio).getTime() < CICLO_DIAS * 864e5) {
        const prox = new Date(new Date(ultimoInicio).getTime() + CICLO_DIAS * 864e5);
        log(`Rede: ciclo em dia; próximo começa em ${prox.toISOString().slice(0, 10)}`);
        return { emDia: true, proximoCiclo: prox.toISOString().slice(0, 10) };
      }
      inicio = new Date().toISOString();
      await setConfig('rede_inicio', inicio);
      await setConfig('rede_cursor', '');
    }
  }
  const cursor = (await getConfig(chaveCursor)) || '';

  // Lista de trabalho: cada (cidade, tabela) com seus planos, em ordem estável.
  const tabelas = new Map((await lerTudo('tabelas', 'id,nome,operadora,operadora_id,planos', (q) => q.eq('ativa', true))).filter(doGrupo(grupo)).map((t) => [t.id, t]));
  const cidades = new Map((await lerTudo('cidades', 'id,nome,uf,uf_id')).map((c) => [c.id, c]));
  // Ordem do ciclo: UFs prioritárias primeiro (CE, SP, RJ), depois o resto do Brasil.
  const prioridade = (uf) => { const i = UFS_PRIORITARIAS.indexOf(uf); return i === -1 ? 9 : i; };
  const vinculos = (await lerTudo('tabela_cidade', 'tabela_id,cidade_id'))
    .filter((v) => tabelas.has(v.tabela_id) && cidades.has(v.cidade_id))
    .map((v) => ({ ...v, k: `${prioridade(cidades.get(v.cidade_id).uf)}|${String(v.cidade_id).padStart(7, '0')}|${String(v.tabela_id).padStart(7, '0')}` }))
    .sort((a, b) => (a.k < b.k ? -1 : 1));
  // Pula o que já foi coletado há pouco (no ciclo geral ou numa prioridade anterior): não refaz rede recente.
  const recentes = new Set();
  {
    const desde = new Date(Date.now() - 30 * 864e5).toISOString();
    for (const r of await lerTudo('rede', 'tabela_id,cidade_id', (q) => q.gte('atualizado_em', desde))) recentes.add(`${r.tabela_id}|${r.cidade_id}`);
  }
  const pendentes = vinculos.filter((v) => v.k > cursor && !recentes.has(`${v.tabela_id}|${v.cidade_id}`));
  const baseline = (await getConfig('rede_baseline_ok')) !== '1';
  log(`Rede: ${pendentes.length} de ${vinculos.length} (cidade×tabela) pendentes no ciclo (baseline=${baseline})`);

  let feitos = 0;
  for (let i = 0; i < pendentes.length && !tempoAcabou(); i += 30) {
    const lote = pendentes.slice(i, i + 30);
    const linhas = [];
    await emParalelo(lote, async (v) => {
      const t = tabelas.get(v.tabela_id); const c = cidades.get(v.cidade_id);
      const planos = t.planos || [];
      for (let j = 0; j < planos.length; j += 5) {
        const grupo = planos.slice(j, j + 5);
        const d = await cot.ferramenta('cotacao.rede-credenciada', {
          ufId: c.uf_id, cidadeId: c.id, limitePorPlano: 200,
          planos: grupo.map((p, idx) => ({ indice: idx, operadoraId: t.operadora_id, tabelaId: t.id, planoId: p.id })),
        });
        for (const r of d?.planos || []) {
          let locais = r.locais || [];
          let truncado = !!r.truncado;
          if (truncado) {
            // Mais de 200 locais: busca por tipo para completar.
            const porTipo = new Map(locais.map((l) => [`${l.tipo}|${l.nome}`, l]));
            for (const tipoLocal of TIPOS_DIVIDIR) {
              const d2 = await cot.ferramenta('cotacao.rede-credenciada', {
                ufId: c.uf_id, cidadeId: c.id, limitePorPlano: 200, tipoLocal,
                planos: [{ indice: 0, operadoraId: t.operadora_id, tabelaId: t.id, planoId: r.planoId }],
              });
              for (const l of d2?.planos?.[0]?.locais || []) porTipo.set(`${l.tipo}|${l.nome}`, l);
            }
            locais = [...porTipo.values()];
            truncado = locais.length < (r.totalLocais || 0);
          }
          locais.sort((a, b) => (`${a.tipo}|${a.nome}` < `${b.tipo}|${b.nome}` ? -1 : 1));
          linhas.push({ tabela_id: t.id, plano_id: r.planoId, cidade_id: c.id, plano: r.plano, tem_rede: !!r.temRede,
            total: r.totalLocais ?? locais.length, truncado, locais, atualizado_em: new Date().toISOString(),
            _t: t, _c: c });
        }
      }
      v.ok = true;
    });

    // compara com o que havia
    if (!baseline && linhas.length) {
      const antes = new Map();
      for (const [cid, ls] of agrupar(linhas, (l) => l.cidade_id)) {
        const { data } = await db.from('rede').select('tabela_id,plano_id,cidade_id,locais')
          .eq('cidade_id', cid).in('tabela_id', [...new Set(ls.map((l) => l.tabela_id))]);
        for (const r of data || []) antes.set(`${r.tabela_id}|${r.plano_id}|${r.cidade_id}`, r.locais || []);
      }
      // agrupa por tabela+cidade para não gerar um alerta por plano
      for (const [k, ls] of agrupar(linhas, (l) => `${l.tabela_id}|${l.cidade_id}`)) {
        const entrou = new Set(), saiu = new Set();
        for (const l of ls) {
          const a = antes.get(`${l.tabela_id}|${l.plano_id}|${l.cidade_id}`);
          if (!a) continue;
          const nomesA = new Set(a.map((x) => x.nome)), nomesN = new Set(l.locais.map((x) => x.nome));
          for (const n of nomesN) if (!nomesA.has(n)) entrou.add(n);
          for (const n of nomesA) if (!nomesN.has(n)) saiu.add(n);
        }
        if (entrou.size || saiu.size) {
          const { _t: t, _c: c } = ls[0];
          const partes = [];
          if (entrou.size) partes.push(`entrou ${[...entrou].slice(0, 5).join(', ')}${entrou.size > 5 ? ` (+${entrou.size - 5})` : ''}`);
          if (saiu.size) partes.push(`saiu ${[...saiu].slice(0, 5).join(', ')}${saiu.size > 5 ? ` (+${saiu.size - 5})` : ''}`);
          registrarMudanca({ tipo: 'rede', operadora: t.operadora, tabela_id: t.id, uf: c.uf, chave: k,
            descricao: `Rede — ${t.nome} em ${c.nome}/${c.uf}: ${partes.join('; ')}`,
            antes: { saiu: [...saiu] }, depois: { entrou: [...entrou] } });
        }
      }
    }

    if (linhas.length) await gravar('rede', linhas.map(({ _t, _c, ...l }) => l), 'tabela_id,plano_id,cidade_id');
    // avança o cursor só até o último item contínuo que deu certo
    let ultimo = null;
    for (const v of lote) { if (!v.ok) break; ultimo = v.k; }
    if (ultimo) await setConfig(chaveCursor, ultimo);
    feitos += lote.filter((v) => v.ok).length;
    if (lote.some((v) => !v.ok)) { log('Rede: falha num lote; retoma daqui na próxima execução'); break; }
    if ((i / 30) % 10 === 0) log(`Rede: ${i + lote.length}/${pendentes.length}, ${cot.chamadas} chamadas`);
  }

  const cursorFinal = (await getConfig(chaveCursor)) || '';
  const restantes = vinculos.filter((v) => v.k > cursorFinal && !recentes.has(`${v.tabela_id}|${v.cidade_id}`)).length;
  if (prio) {
    if (restantes === 0) await setConfig(chaveCursor, '');
    return { grupo, completo: restantes === 0, feitos, restantes };
  }
  if (restantes === 0) {
    await setConfig('rede_ultimo_inicio', inicio);
    await setConfig('rede_inicio', null);
    await setConfig('rede_cursor', '');
    await setConfig('rede_baseline_ok', '1');
    return { cicloCompleto: true, feitos };
  }
  return { cicloCompleto: false, feitos, restantes };
}
