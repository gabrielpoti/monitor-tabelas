// Uso: node src/index.js <diario|semanal|cidades|area|teste>
//  diario  → preços por faixa + coparticipação + carência das tabelas ativas, com alerta no Telegram
//  semanal → liga cidades do IBGE ao cotador e varre a área de comercialização (retoma de onde parou)

import { db, inserir } from './db.js';
import { Cotador } from './cotador.js';
import { sincronizarCidades } from './cidades.js';
import { varrerArea } from './area.js';
import { conferirPrecos, conferirRegras } from './diario.js';
import { varrerRede } from './rede.js';
import { conferirDescontos } from './descontos.js';
import { enviar, montarRelatorio } from './telegram.js';
import { log, minutos, ultimoLog } from './util.js';

const modo = process.argv[2] || 'diario';

async function main() {
  // Execuções que ficaram "rodando" porque o GitHub cortou no limite de tempo.
  await db.from('execucoes').update({ status: 'interrompida', fim: new Date().toISOString() })
    .eq('status', 'rodando').lt('inicio', new Date(Date.now() - 6.5 * 3600e3).toISOString());
  const { data: exec, error } = await db.from('execucoes').insert({ modo }).select('id').single();
  if (error) throw new Error('Supabase: ' + error.message);
  const mudancas = [];
  const registrarMudanca = (m) => mudancas.push({ ...m, execucao_id: exec.id });
  const cot = new Cotador();
  const resumo = {};
  // Progresso visível no site enquanto roda (a cada minuto).
  const pulso = setInterval(() => {
    db.from('execucoes').update({ chamadas: cot.chamadas, erros: cot.erros, resumo: { fase: ultimoLog } })
      .eq('id', exec.id).eq('status', 'rodando').then(() => {}, () => {});
  }, 60_000);
  pulso.unref();

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
    // A área só roda com a lista de cidades completa — senão a "varredura completa" ficaria parcial.
    if (modo === 'area' || (modo === 'semanal' && resumo.cidades?.completo)) resumo.area = await varrerArea(cot, registrarMudanca);
    if (modo === 'semanal' && !resumo.cidades?.completo) resumo.area = { completa: false, aguardandoCidades: true };
    if (modo === 'rede') resumo.rede = await varrerRede(cot, registrarMudanca);
    if (modo === 'prioridade') {
      // Uma operadora inteira de uma vez: preços, coparticipação, carência, descontos e rede.
      const grupo = process.env.GRUPO;
      if (!grupo) throw new Error('Modo prioridade precisa da operadora (campo grupo, ex.: Unimed)');
      log(`Prioridade: ${grupo}`);
      resumo.precos = await conferirPrecos(cot, registrarMudanca, { grupo });
      resumo.regras = await conferirRegras(cot, registrarMudanca, { grupo });
      resumo.descontos = await conferirDescontos(cot, registrarMudanca, { grupo });
      resumo.rede = await varrerRede(cot, registrarMudanca, { grupo });
    }
    if (modo === 'descontos') resumo.descontos = await conferirDescontos(cot, registrarMudanca);
    if (modo === 'diario') {
      resumo.precos = await conferirPrecos(cot, registrarMudanca);
      resumo.regras = await conferirRegras(cot, registrarMudanca);
    }

    if (mudancas.length) await inserir('mudancas', mudancas);
    resumo.errosCotador = cot.resumoErros();
    await db.from('execucoes').update({
      fim: new Date().toISOString(), status: 'ok', chamadas: cot.chamadas, erros: cot.erros, resumo,
    }).eq('id', exec.id);

    log('Resumo:', JSON.stringify(resumo, null, 1).slice(0, 3000));
    if (modo !== 'teste') {
      const extras = [`${cot.chamadas} consultas ao cotador, ${cot.erros} com erro, ${minutos()} min`];
      if (resumo.area && !resumo.area.completa) extras.push('varredura de área continua na próxima execução');
      if (resumo.rede?.restantes) extras.push(`rede: faltam ${resumo.rede.restantes} cidade×tabela no ciclo`);
      if (resumo.precos?.interrompido) extras.push('conferência de preços interrompida por tempo');
      if (resumo.precos?.lotesComFalha) extras.push(`${resumo.precos.lotesComFalha} lote(s) de preço falharam (mantidos os de ontem)`);
      // Na 1ª carga não há o que comparar: avisa só que a base foi montada.
      const silencioso = !mudancas.length && (
        (modo === 'semanal' && resumo.area && !resumo.area.completa) ||
        (modo === 'rede' && (resumo.rede?.emDia || resumo.rede?.aguardandoArea || !resumo.rede?.cicloCompleto)) ||
        (modo === 'descontos' && resumo.descontos?.aguardandoArea));
      const saude = { chamadas: cot.chamadas, erros: cot.erros, errosCotador: resumo.errosCotador };
      const comProblema = cot.chamadas > 0 && cot.erros / cot.chamadas > 0.05;
      if (!silencioso || comProblema) await enviar(montarRelatorio(modo, mudancas, extras.join(' · '), saude));
    }
  } catch (e) {
    console.error(e);
    if (mudancas.length) await inserir('mudancas', mudancas).catch(() => {});
    await db.from('execucoes').update({
      fim: new Date().toISOString(), status: 'erro', chamadas: cot.chamadas, erros: cot.erros,
      resumo: { ...resumo, erro: String(e.message || e), errosCotador: cot.resumoErros() },
    }).eq('id', exec.id);
    await enviar(`⚠️ <b>Monitor de Tabelas (${modo}) falhou</b>\n${String(e.message || e).slice(0, 800)}`);
    process.exit(1);
  }
}

main();
