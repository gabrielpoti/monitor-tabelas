// Uso: node src/index.js <diario|semanal|cidades|area|teste>
//  diario  → preços por faixa + coparticipação + carência das tabelas ativas, com alerta no Telegram
//  semanal → liga cidades do IBGE ao cotador e varre a área de comercialização (retoma de onde parou)

import { db, inserir } from './db.js';
import { Cotador } from './cotador.js';
import { sincronizarCidades } from './cidades.js';
import { varrerArea } from './area.js';
import { conferirPrecos, conferirRegras } from './diario.js';
import { enviar, montarRelatorio } from './telegram.js';
import { log, minutos } from './util.js';

const modo = process.argv[2] || 'diario';

async function main() {
  const { data: exec, error } = await db.from('execucoes').insert({ modo }).select('id').single();
  if (error) throw new Error('Supabase: ' + error.message);
  const mudancas = [];
  const registrarMudanca = (m) => mudancas.push({ ...m, execucao_id: exec.id });
  const cot = new Cotador();
  const resumo = {};

  try {
    await cot.iniciar();
    log(`Conectado ao cotador. ${cot.ferramentas.size} ferramentas.`);

    if (modo === 'teste') {
      resumo.quemSou = await cot.ferramenta('contexto.quem-sou', {});
      const c = await cot.buscarCidade('CE', 'Fortaleza');
      resumo.fortaleza = c?.cidades?.[0];
      resumo.ferramentas = [...cot.ferramentas.values()];
    }
    if (modo === 'cidades' || modo === 'semanal') resumo.cidades = await sincronizarCidades(cot);
    if (modo === 'area' || modo === 'semanal') resumo.area = await varrerArea(cot, registrarMudanca);
    if (modo === 'diario') {
      resumo.precos = await conferirPrecos(cot, registrarMudanca);
      resumo.regras = await conferirRegras(cot, registrarMudanca);
    }

    if (mudancas.length) await inserir('mudancas', mudancas);
    await db.from('execucoes').update({
      fim: new Date().toISOString(), status: 'ok', chamadas: cot.chamadas, erros: cot.erros, resumo,
    }).eq('id', exec.id);

    log('Resumo:', JSON.stringify(resumo, null, 1).slice(0, 3000));
    if (modo !== 'teste') {
      const extras = [`${cot.chamadas} consultas ao cotador, ${cot.erros} com erro, ${minutos()} min`];
      if (resumo.area && !resumo.area.completa) extras.push('varredura de área continua na próxima execução');
      if (resumo.precos?.interrompido) extras.push('conferência de preços interrompida por tempo');
      if (resumo.precos?.lotesComFalha) extras.push(`${resumo.precos.lotesComFalha} lote(s) de preço falharam (mantidos os de ontem)`);
      // Na 1ª carga não há o que comparar: avisa só que a base foi montada.
      const silencioso = modo === 'semanal' && !mudancas.length && resumo.area && !resumo.area.completa;
      if (!silencioso) await enviar(montarRelatorio(modo, mudancas, extras.join(' · ')));
    }
  } catch (e) {
    console.error(e);
    if (mudancas.length) await inserir('mudancas', mudancas).catch(() => {});
    await db.from('execucoes').update({
      fim: new Date().toISOString(), status: 'erro', chamadas: cot.chamadas, erros: cot.erros,
      resumo: { ...resumo, erro: String(e.message || e) },
    }).eq('id', exec.id);
    await enviar(`⚠️ <b>Monitor de Tabelas (${modo}) falhou</b>\n${String(e.message || e).slice(0, 800)}`);
    process.exit(1);
  }
}

main();
