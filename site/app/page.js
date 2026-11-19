import { db, tudo, config } from '@/lib/db';
import { GRUPOS, slug, dataHoraBR, dataBR, TIPOS_MUDANCA, grupoDe } from '@/lib/util';

export const dynamic = 'force-dynamic';

export default async function Painel({ searchParams }) {
  const sp = await searchParams;
  const s = db();
  const [execs, cidades, tabelas, precosC, naoLidas, ultimas, agendados, areaCursor, areaOk, redeInicio, redeUlt, redeC] = await Promise.all([
    s.from('execucoes').select('id,modo,status,inicio,fim,chamadas,erros,resumo').order('id', { ascending: false }).limit(8),
    s.from('cidades').select('id', { count: 'exact', head: true }),
    tudo(() => s.from('v_tabelas').select('grupo,ativa,cidades')),
    s.from('precos').select('chave', { count: 'exact', head: true }),
    s.from('mudancas').select('id', { count: 'exact', head: true }).eq('lida', false),
    s.from('mudancas').select('id,tipo,operadora,descricao,detectado_em,lida').order('id', { ascending: false }).limit(6),
    s.from('precos').select('tabela_id,uf,novo_preco_em').gte('novo_preco_em', new Date().toISOString()).order('novo_preco_em').limit(500),
    config('area_cursor'), config('area_baseline_ok'), config('rede_inicio'), config('rede_ultimo_inicio'),
    s.from('rede').select('tabela_id', { count: 'exact', head: true }),
  ]);
  const naoAchadas = await s.from('cidades_nao_encontradas').select('ibge', { count: 'exact', head: true });
  const { count: cidadesMapeadas } = areaCursor && areaCursor !== '0'
    ? await s.from('cidades').select('id', { count: 'exact', head: true }).lte('id', Number(areaCursor))
    : { count: areaOk === '1' ? cidades.count : 0 };

  const porGrupo = Object.fromEntries(GRUPOS.map((g) => [g, 0]));
  for (const t of tabelas) if (t.ativa && porGrupo[t.grupo] != null) porGrupo[t.grupo]++;
  const totalCidades = cidades.count || 0;
  const pctArea = areaOk === '1' && (!areaCursor || areaCursor === '0') ? 100 : totalCidades ? Math.round((cidadesMapeadas / totalCidades) * 100) : 0;

  const agend = new Map();
  for (const p of agendados.data || []) {
    const k = `${p.tabela_id}|${p.uf}|${p.novo_preco_em.slice(0, 10)}`;
    if (!agend.has(k)) agend.set(k, p);
  }
  const nomesTab = new Map();
  if (agend.size) {
    const ids = [...new Set([...agend.values()].map((p) => p.tabela_id))].slice(0, 200);
    const { data } = await s.from('tabelas').select('id,nome,operadora').in('id', ids);
    for (const t of data || []) nomesTab.set(t.id, t);
  }
  const ultimaPor = (modo) => (execs.data || []).find((e) => e.modo === modo);

  return (
    <>
      <h1>Painel</h1>
      <p className="sub">Situação do monitor e das tabelas monitoradas.</p>
      {sp.rodou && <div className="aviso">Execução "{sp.rodou}" disparada no GitHub. Ela aparece aqui em instantes.</div>}
      {sp.erroRodar && <div className="aviso">Não consegui disparar: {sp.erroRodar}</div>}

      <div className="grade">
        <div className="cartao"><div className="rotulo">Alterações não lidas</div><div className="num">{naoLidas.count || 0}</div><a href="/alteracoes?lida=nao">Ver alterações →</a></div>
        <div className="cartao"><div className="rotulo">Tabelas ativas</div><div className="num">{tabelas.filter((t) => t.ativa).length}</div><span className="pequeno">{(precosC.count || 0).toLocaleString('pt-BR')} preços guardados</span></div>
        <div className="cartao">
          <div className="rotulo">Cidades ligadas ao cotador</div>
          <div className="num">{Math.min(100, Math.round(((totalCidades + (naoAchadas.count || 0)) / 5571) * 100))}%</div>
          <div className="barra"><div style={{ width: `${Math.min(100, ((totalCidades + (naoAchadas.count || 0)) / 5571) * 100)}%` }} /></div>
          <span className="pequeno">{totalCidades.toLocaleString('pt-BR')} de 5.571 municípios do IBGE{naoAchadas.count ? ` · ${naoAchadas.count} não existem no cotador` : ''}</span>
        </div>
        <div className="cartao">
          <div className="rotulo">Área de comercialização</div>
          <div className="num">{pctArea}%</div>
          <div className="barra"><div style={{ width: `${pctArea}%` }} /></div>
          <span className="pequeno">{(cidadesMapeadas || 0).toLocaleString('pt-BR')} de {totalCidades.toLocaleString('pt-BR')} cidades {areaOk === '1' ? '· base completa' : totalCidades + (naoAchadas.count || 0) < 5571 ? '· começa quando todas as cidades estiverem ligadas' : '· 1ª carga em andamento'}</span>
        </div>
        <div className="cartao">
          <div className="rotulo">Rede credenciada (ciclo 90 dias)</div>
          <div className="num">{(redeC.count || 0).toLocaleString('pt-BR')}</div>
          <span className="pequeno">{redeInicio ? `ciclo em andamento desde ${dataBR(redeInicio)}` : redeUlt ? `último ciclo começou em ${dataBR(redeUlt)}` : areaOk === '1' ? 'começa na próxima execução' : 'começa após a 1ª carga da área'}</span>
        </div>
      </div>

      <h2>Operadoras</h2>
      <div className="grade">
        {GRUPOS.map((g) => (
          <a key={g} href={`/operadoras/${slug(g)}`} className="cartao" style={{ color: 'inherit' }}>
            <div className="linha"><img className="logo-op" src={`/api/logo/${slug(g)}`} alt="" /><h3>{g}</h3></div>
            <span className="rotulo">{porGrupo[g]} tabela(s) ativa(s)</span>
          </a>
        ))}
      </div>

      <h2>Últimas alterações</h2>
      {(ultimas.data || []).length ? (
        <div className="rolagem"><table><tbody>
          {ultimas.data.map((m) => (
            <tr key={m.id} className={m.lida ? '' : 'naolida'}>
              <td className="pequeno">{dataHoraBR(m.detectado_em)}</td>
              <td><span className="chip">{TIPOS_MUDANCA[m.tipo] || m.tipo}</span> <b>{grupoDe(m.operadora)}</b><br />{m.descricao}</td>
            </tr>))}
        </tbody></table></div>
      ) : <div className="vazio">Nenhuma alteração ainda. A primeira carga só monta a base; os alertas começam depois.</div>}

      <h2>Próximos reajustes agendados</h2>
      {agend.size ? (
        <div className="rolagem"><table><thead><tr><th>Data</th><th>Tabela</th><th>UF</th></tr></thead><tbody>
          {[...agend.values()].slice(0, 8).map((p) => { const t = nomesTab.get(p.tabela_id); return (
            <tr key={`${p.tabela_id}${p.uf}${p.novo_preco_em}`}><td>{dataBR(p.novo_preco_em)}</td><td><a href={`/tabela/${p.tabela_id}`}>{t?.nome || p.tabela_id}</a> <span className="pequeno">{grupoDe(t?.operadora)}</span></td><td>{p.uf}</td></tr>); })}
        </tbody></table></div>
      ) : <div className="vazio">Nenhum preço novo agendado no momento.</div>}
      <p><a href="/reajustes">Calendário completo →</a></p>

      <h2>Execuções do monitor</h2>
      <div className="grade" style={{ marginBottom: '.75rem' }}>
        {['diario', 'semanal', 'rede'].map((m) => { const e = ultimaPor(m); return (
          <div key={m} className="cartao">
            <div className="rotulo">Última {m === 'diario' ? 'conferência diária' : m === 'semanal' ? 'varredura de área' : 'varredura de rede'}</div>
            <div>{e ? <>{dataHoraBR(e.inicio)} <span className={`chip ${e.status === 'ok' ? 'ok' : e.status === 'erro' ? 'erro' : 'alerta'}`}>{e.status}</span></> : 'ainda não rodou'}</div>
            <form action="/api/rodar" method="post" style={{ marginTop: '.5rem' }}>
              <input type="hidden" name="modo" value={m} />
              <button className="sec" type="submit">Rodar agora</button>
            </form>
          </div>); })}
      </div>
      <div className="rolagem"><table>
        <thead><tr><th>#</th><th>Modo</th><th>Início</th><th>Fim</th><th>Status</th><th className="n">Consultas</th><th className="n">Com erro</th><th>Andamento / erro</th></tr></thead>
        <tbody>{(execs.data || []).map((e) => (
          <tr key={e.id}><td>{e.id}</td><td>{e.modo}</td><td>{dataHoraBR(e.inicio)}</td><td>{dataHoraBR(e.fim)}</td>
            <td><span className={`chip ${e.status === 'ok' ? 'ok' : e.status === 'erro' ? 'erro' : 'alerta'}`}>{e.status}</span></td>
            <td className="n">{(e.chamadas || 0).toLocaleString('pt-BR')}</td><td className="n">{(e.erros || 0).toLocaleString('pt-BR')}</td>
            <td className="pequeno">{e.resumo?.erro || (e.status === 'rodando' ? e.resumo?.fase || '' : '')}</td></tr>))}
        </tbody></table></div>
    </>
  );
}
