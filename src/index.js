// Uso: node src/index.js <diario|semanal|cidades|area|teste>
//  diario  → preços por faixa + coparticipação + carência das tabelas ativas, com alerta no Telegram
//  semanal → liga cidades do IBGE ao cotador e varre a área de comercialização (retoma de onde parou)

import { db, inserir, getConfig, setConfig } from './db.js';
import { Cotador } from './cotador.js';
import { sincronizarCidades } from './cidades.js';
import { varrerArea } from './area.js';
import { conferirPrecos, conferirRegras, FILTROS_ESCOPO, escoposDoDia } from './diario.js';
import { varrerRede } from './rede.js';
import { conferirDescontos } from './descontos.js';
import { descobrirTabelas } from './descobrir.js';
import { enviar, montarRelatorio } from './telegram.js';
import { log, minutos, ultimoLog, tempoAcabou } from './util.js';

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
    log(`Conectado ao cotador. ${cot.ferramentas.size} ferramentas, ${cot.contas.length} conta(s): ${cot.contas.map((c) => c.nome).join(', ')}.`);

    if (modo === 'teste') {
      resumo.quemSou = await cot.ferramenta('contexto.quem-sou', {}, { fixa: true });
      const c = await cot.buscarCidade('CE', 'Fortaleza');
      resumo.fortaleza = c?.cidades?.[0];
      resumo.ferramentas = [...cot.ferramentas.values()];
    }
    if (modo === 'comparar') {
      // Compara as tabelas que a conta conectada enxerga com o que está no banco (amostra de cidades grandes).
      resumo.quemSou = await cot.ferramenta('contexto.quem-sou', {}, { fixa: true });
      const { lerTudo } = await import('./db.js');
      const { monitorada, TIPOS_TABELA } = await import('./config.js');
      const nomes = ['São Paulo/SP', 'Rio de Janeiro/RJ', 'Fortaleza/CE', 'Belo Horizonte/MG', 'Curitiba/PR', 'Salvador/BA', 'Recife/PE',
        'Brasília/DF', 'Goiânia/GO', 'Manaus/AM', 'Belém/PA', 'Porto Alegre/RS', 'Campinas/SP', 'Guarulhos/SP', 'Natal/RN', 'Joinville/SC'];
      const cidades = (await lerTudo('cidades', 'id,nome,uf,uf_id')).filter((c) => nomes.includes(`${c.nome}/${c.uf}`));
      const out = [];
      for (const c of cidades) {
        const banco = new Set((await lerTudo('tabela_cidade', 'tabela_id', (q) => q.eq('cidade_id', c.id))).map((x) => x.tabela_id));
        const conta = new Set();
        for (const tipo of TIPOS_TABELA) for (const t of (await cot.listarTabelas(c.uf_id, c.id, tipo)).filter(monitorada)) conta.add(t.id);
        const soBanco = [...banco].filter((x) => !conta.has(x)), soConta = [...conta].filter((x) => !banco.has(x));
        out.push({ cidade: `${c.nome}/${c.uf}`, banco: banco.size, conta: conta.size, soBanco, soConta });
      }
      resumo.comparacao = out;
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
      // Operadora recém-incluída: descobre as tabelas nas UFs informadas antes de cotar.
      if (process.env.UFS) resumo.descoberta = await descobrirTabelas(cot, { grupo, ufs: process.env.UFS.split(',').map((u) => u.trim().toUpperCase()).filter(Boolean) });
      // Continuação de uma prioridade longa: preços/regras/descontos já feitos nos últimos 3 dias não se repetem.
      const chaveBase = `prioridade_base_${grupo}`;
      const base = await getConfig(chaveBase);
      if (!base || Date.now() - new Date(base).getTime() > 3 * 864e5) {
        resumo.precos = await conferirPrecos(cot, registrarMudanca, { grupo });
        resumo.regras = await conferirRegras(cot, registrarMudanca, { grupo });
        resumo.descontos = await conferirDescontos(cot, registrarMudanca, { grupo });
        await setConfig(chaveBase, new Date().toISOString());
      } else log(`Preços, regras e descontos de ${grupo} já conferidos em ${base}; indo direto para a rede.`);
      resumo.rede = await varrerRede(cot, registrarMudanca, { grupo });
      // Se a rede não fechou nesta execução, fica marcada para continuar sozinha (src/continuar.js).
      // Fila de prioridades (mais de uma operadora pode estar na fila; a da vez fica na frente até fechar).
      const lerFila = (v) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : [x]; } catch { return v ? [v] : []; } };
      let fila = lerFila(await getConfig('prioridade_pendente')).filter((g) => g && g !== grupo);
      if (!resumo.rede?.completo) fila = [grupo, ...fila];
      await setConfig('prioridade_pendente', fila.length ? JSON.stringify(fila) : null);
      if (resumo.rede?.completo) await setConfig(chaveBase, null);
    }
    if (modo === 'regras') resumo.regras = await conferirRegras(cot, registrarMudanca, process.env.GRUPO ? { grupo: process.env.GRUPO } : {});
    if (modo === 'descontos') resumo.descontos = await conferirDescontos(cot, registrarMudanca);
    if (modo === 'diario') {
      // Escopos do dia (prioridade = Hapvida/NotreDame/Unimed em SP/RJ/CE, dia sim dia não; demais = terça e sábado).
      // Não cabendo numa execução (o Cotador limita o ritmo), guarda onde parou e a próxima continua dali.
      const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
      let cur = null; try { cur = JSON.parse((await getConfig('diario_cursor')) || 'null'); } catch {}
      if (cur && Date.now() - new Date(cur.em).getTime() > 20 * 3600e3) cur = null;
      const manual = ['prioridade', 'demais', 'todos'].includes(process.env.GRUPO) ? process.env.GRUPO : null;
      let fila = cur ? [cur.escopo, ...(cur.restantes || [])] : manual === 'todos' ? ['prioridade', 'demais'] : manual ? [manual] : escoposDoDia(hoje);
      resumo.escopos = [...fila];
      if (!fila.length) log('Hoje não há conferência diária programada (prioridade: dia sim, dia não; demais: terça e sábado).');
      const base = { dia: cur?.dia || hoje, em: cur?.em || new Date().toISOString() };
      let parou = null;
      while (fila.length && !parou) {
        const escopo = fila.shift();
        const filtro = FILTROS_ESCOPO[escopo];
        const retomar = cur && cur.escopo === escopo ? cur : null;
        resumo[escopo] = {};
        if (!retomar || retomar.etapa === 'precos') {
          resumo[escopo].precos = await conferirPrecos(cot, registrarMudanca, { filtro, inicio: retomar?.lote || 0 });
          if (resumo[escopo].precos?.interrompido) { parou = { ...base, escopo, etapa: 'precos', lote: resumo[escopo].precos.proximoLote, restantes: fila }; break; }
        }
        if (tempoAcabou()) { parou = { ...base, escopo, etapa: 'regras', regras: null, restantes: fila }; break; }
        resumo[escopo].regras = await conferirRegras(cot, registrarMudanca, { filtro, inicio: retomar?.etapa === 'regras' ? retomar.regras : null });
        if (resumo[escopo].regras?.parou) { parou = { ...base, escopo, etapa: 'regras', regras: resumo[escopo].regras.parou, restantes: fila }; break; }
        cur = null;
      }
      await setConfig('diario_cursor', parou ? JSON.stringify(parou) : null);
      if (parou) {
        let f = []; try { f = JSON.parse((await getConfig('fila_execucoes')) || '[]'); } catch {}
        await setConfig('fila_execucoes', JSON.stringify([{ modo: 'diario' }, ...f.filter((x) => x.modo !== 'diario')]));
        resumo.continua = parou;
      }
    }

    if (mudancas.length) await inserir('mudancas', mudancas);
    resumo.errosCotador = cot.resumoErros();
    resumo.contas = cot.resumoContas();
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
      resumo: { ...resumo, erro: String(e.message || e), errosCotador: cot.resumoErros(), contas: cot.resumoContas() },
    }).eq('id', exec.id);
    await enviar(`⚠️ <b>Monitor de Tabelas (${modo}) falhou</b>\n${String(e.message || e).slice(0, 800)}`);
    process.exit(1);
  }
}

main();
