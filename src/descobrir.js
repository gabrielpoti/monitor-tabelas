// Descoberta rápida das tabelas de uma operadora recém-incluída, só nas UFs informadas
// (ex.: Alice em SP), para não esperar a varredura semanal do Brasil inteiro.
// As cidades achadas aqui não geram alerta de "área entrou" na próxima varredura.
import { lerTudo, gravar, getConfig, setConfig } from './db.js';
import { TIPOS_TABELA, monitorada } from './config.js';
import { tempoAcabou, log, emParalelo, doGrupo } from './util.js';

export async function descobrirTabelas(cot, { grupo, ufs }) {
  const cidades = (await lerTudo('cidades', 'id,nome,uf,uf_id', (q) => q.in('uf', ufs).order('id')));
  log(`Descoberta ${grupo}: ${cidades.length} cidades em ${ufs.join(', ')}`);
  const tabelas = new Map(), vinculos = [];
  const agora = new Date().toISOString();
  for (let i = 0; i < cidades.length && !tempoAcabou(); i += 40) {
    await emParalelo(cidades.slice(i, i + 40), async (c) => {
      for (const tipo of TIPOS_TABELA) {
        const itens = (await cot.listarTabelas(c.uf_id, c.id, tipo)).filter(monitorada).filter(doGrupo(grupo));
        for (const t of itens) {
          const ant = tabelas.get(t.id);
          const planos = new Map((ant?.planos || []).map((p) => [p.id, p.nome]));
          for (const p of t.planos || []) planos.set(p.id, p.nome);
          tabelas.set(t.id, {
            id: t.id, nome: t.nome, operadora_id: t.operadoraId, operadora: t.operadora, administradora: t.administradora,
            tipo_tabela: tipo, uf_id: c.uf_id, minimo_vidas: t.minimoVidas, exige_entidade: t.exigeEntidade,
            planos: [...planos].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.id - b.id), ativa: true, ultima_vez: agora,
          });
          vinculos.push({ tabela_id: t.id, cidade_id: c.id, ultima_vez: agora });
        }
      }
    });
    if ((i / 40) % 5 === 0) log(`Descoberta ${grupo}: ${Math.min(i + 40, cidades.length)}/${cidades.length} cidades, ${tabelas.size} tabelas`);
  }
  if (tabelas.size) await gravar('tabelas', [...tabelas.values()], 'id');
  const dedup = [...new Map(vinculos.map((v) => [`${v.tabela_id}|${v.cidade_id}`, v])).values()];
  if (dedup.length) await gravar('tabela_cidade', dedup, 'tabela_id,cidade_id');
  const silenciar = new Set(JSON.parse((await getConfig('area_silenciar')) || '[]'));
  for (const id of tabelas.keys()) silenciar.add(id);
  await setConfig('area_silenciar', JSON.stringify([...silenciar]));
  log(`Descoberta ${grupo}: ${tabelas.size} tabelas em ${new Set(dedup.map((v) => v.cidade_id)).size} cidades`);
  return { tabelas: tabelas.size, cidades: new Set(dedup.map((v) => v.cidade_id)).size };
}
