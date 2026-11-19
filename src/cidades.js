// Liga os 5.570 municípios do IBGE aos ids de cidade do cotador.
// Só busca o que ainda não foi encontrado; pode ser interrompido e retomado.

import { db, lerTudo, gravar } from './db.js';
import { semAcento, tempoAcabou, log, emParalelo } from './util.js';

const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado';

export async function sincronizarCidades(cot) {
  const r = await fetch(IBGE);
  if (!r.ok) throw new Error('IBGE indisponível: ' + r.status);
  const municipios = (await r.json()).map((m) => ({
    ibge: String(m['municipio-id']), nome: m['municipio-nome'], uf: m['UF-sigla'],
  }));

  const feitas = new Set((await lerTudo('cidades', 'ibge')).map((c) => c.ibge));
  const falhas = new Set((await lerTudo('cidades_nao_encontradas', 'ibge')).map((c) => c.ibge));
  const pendentes = municipios.filter((m) => !feitas.has(m.ibge) && !falhas.has(m.ibge));
  log(`Cidades: ${municipios.length} no IBGE, ${feitas.size} já ligadas, ${pendentes.length} a buscar`);

  let achadas = 0, perdidas = 0;
  for (let i = 0; i < pendentes.length && !tempoAcabou(); i += 60) {
    const lote = pendentes.slice(i, i + 60);
    const ok = [], nao = [];
    await emParalelo(lote, async (m) => {
      // A busca é por início do nome; nomes longos são cortados para casar melhor.
      const termo = m.nome.length > 40 ? m.nome.slice(0, 40) : m.nome;
      const d = await cot.buscarCidade(m.uf, termo);
      const alvo = semAcento(m.nome);
      const c = (d?.cidades || []).find((x) => semAcento(x.nome) === alvo && x.uf === m.uf);
      if (c) ok.push({ id: c.id, nome: c.nome, uf: c.uf, uf_id: c.ufId, ibge: m.ibge, updated_at: new Date().toISOString() });
      else nao.push({ ibge: m.ibge, uf: m.uf, nome: m.nome });
    });
    // ids repetidos (duas cidades IBGE no mesmo id do cotador) ficam com o primeiro
    const unicos = [...new Map(ok.map((c) => [c.id, c])).values()];
    if (unicos.length) await gravar('cidades', unicos, 'id');
    if (nao.length) await gravar('cidades_nao_encontradas', nao, 'ibge');
    achadas += unicos.length; perdidas += nao.length;
    if ((i / 60) % 10 === 0) log(`Cidades: ${i + lote.length}/${pendentes.length}`);
  }
  const { count } = await db.from('cidades').select('*', { count: 'exact', head: true });
  return { cidadesNoCotador: count, novasAchadas: achadas, naoEncontradas: perdidas, completo: !tempoAcabou() };
}
