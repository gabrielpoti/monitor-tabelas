import { db, config } from '@/lib/db';
import { consultaRede, contarRede, LIMITE_LINHAS } from '@/lib/rede';
import { GRUPOS, slug, grupoDoSlug, tipoLocal, listaTiposLocal, dataBR } from '@/lib/util';

export const dynamic = 'force-dynamic';
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
const POR_PAGINA = 200;

export default async function Rede({ searchParams }) {
  const sp = await searchParams;
  const f = {
    grupo: sp.grupo ? grupoDoSlug(sp.grupo) : null, uf: sp.uf || null, cidade: sp.cidade || null, tipo: sp.tipo || null,
    admin: sp.admin || null, plano: sp.plano || null, q: sp.q || null, tipoTabela: sp.tipoTabela || null,
  };
  const filtrou = Object.values(f).some(Boolean);
  const pagina = Math.max(1, Number(sp.p) || 1);
  const s = db();

  const [resumo, redeInicio, redeUlt, areaOk] = await Promise.all([
    s.rpc('resumo_rede'), config('rede_inicio'), config('rede_ultimo_inicio'), config('area_baseline_ok'),
  ]);
  let linhas = [], total = 0;
  if (filtrou) {
    total = await contarRede(f);
    const { data } = await consultaRede(f, 'grupo,administradora,tabela,tipo_tabela,plano,uf,cidade,local,tipo,cobertura,atualizado_em,tabela_id')
      .order('cidade').order('local').order('grupo').order('plano').range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
    linhas = data || [];
  }
  const qs = new URLSearchParams(Object.entries({ grupo: sp.grupo, uf: sp.uf, cidade: sp.cidade, tipo: sp.tipo, admin: sp.admin, plano: sp.plano, q: sp.q, tipoTabela: sp.tipoTabela }).filter(([, v]) => v)).toString();
  const podeBaixar = f.uf || f.cidade || f.q;
  const paginas = Math.ceil(total / POR_PAGINA);
  const res = resumo.data || [];

  return (
    <>
      <h1>Rede credenciada</h1>
      <p className="sub">Hospitais, pronto-socorros, laboratórios e clínicas de cada plano, por cidade. Filtre e baixe só a rede.</p>
      <p className="pequeno">
        Coleta: {redeInicio ? `ciclo em andamento desde ${dataBR(redeInicio)} (Ceará, São Paulo e Rio primeiro)` : redeUlt ? `último ciclo começou em ${dataBR(redeUlt)}; o próximo começa 90 dias depois` : areaOk === '1' ? 'começa na próxima execução de rede (terça ou sexta)' : 'começa depois que a área de comercialização estiver completa'}.
      </p>

      <form className="filtros" method="get">
        <label>Operadora<select name="grupo" defaultValue={sp.grupo || ''}><option value="">Todas</option>{GRUPOS.map((g) => <option key={g} value={slug(g)}>{g}</option>)}</select></label>
        <label>UF<select name="uf" defaultValue={sp.uf || ''}><option value="">Todas</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label>Cidade<input name="cidade" defaultValue={sp.cidade || ''} placeholder="ex.: Fortaleza" /></label>
        <label>Tipo de atendimento<select name="tipo" defaultValue={sp.tipo || ''}><option value="">Todos</option>{listaTiposLocal().map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Tipo de tabela<select name="tipoTabela" defaultValue={sp.tipoTabela || ''}><option value="">Todos</option><option>PME</option><option>PJ</option><option>PF</option></select></label>
        <label>Administradora<input name="admin" defaultValue={sp.admin || ''} placeholder="ex.: direto, Affix" /></label>
        <label>Plano<input name="plano" defaultValue={sp.plano || ''} placeholder="ex.: Smart" /></label>
        <label>Nome do local<input name="q" defaultValue={sp.q || ''} placeholder="ex.: São Luiz" /></label>
        <button type="submit">Filtrar</button>
        {filtrou && <a className="botao sec" href="/rede">Limpar</a>}
      </form>

      {filtrou && (
        <div className="cartao" style={{ margin: '0 0 1rem' }}>
          <div className="linha">
            <b>{total.toLocaleString('pt-BR')}</b> <span className="rotulo">linha(s) (local × plano)</span>
            {podeBaixar && total <= LIMITE_LINHAS && <a className="botao" href={`/api/rede?${qs}`} style={{ marginLeft: 'auto' }}>Baixar planilha da rede</a>}
          </div>
          {!podeBaixar && <p className="pequeno">Para baixar, escolha uma UF ou uma cidade (ou busque um local pelo nome).</p>}
          {podeBaixar && total > LIMITE_LINHAS && <p className="pequeno">Filtro grande demais para uma planilha ({LIMITE_LINHAS.toLocaleString('pt-BR')} linhas no máximo). Escolha uma operadora ou uma cidade.</p>}
          <p className="pequeno" style={{ marginBottom: 0 }}>A planilha traz 3 abas: <b>Rede</b> (uma linha por local e plano), <b>Resumo por plano</b> (quantos hospitais, laboratórios etc. cada plano tem em cada cidade) e <b>Por local</b> (cada hospital e todos os planos que atendem nele).</p>
        </div>
      )}

      {filtrou ? (linhas.length ? (
        <>
          <div className="rolagem"><table>
            <thead><tr><th>Local</th><th>Tipo</th><th>Cidade</th><th>Operadora</th><th>Plano</th><th>Tabela</th><th>Cobertura</th></tr></thead>
            <tbody>{linhas.map((l, i) => (
              <tr key={i}><td>{l.local}</td><td>{tipoLocal(l.tipo)}</td><td>{l.cidade}/{l.uf}</td><td>{l.grupo}</td><td>{l.plano}</td>
                <td className="pequeno"><a href={`/tabela/${l.tabela_id}?uf=${l.uf}`}>{l.tabela}</a> · {l.administradora} · {l.tipo_tabela}</td><td className="pequeno">{l.cobertura}</td></tr>))}
            </tbody></table></div>
          {paginas > 1 && (
            <div className="linha" style={{ marginTop: '.75rem' }}>
              {pagina > 1 && <a className="botao sec" href={`?${qs}&p=${pagina - 1}`}>← Anteriores</a>}
              <span className="pequeno">Página {pagina} de {paginas}</span>
              {pagina < paginas && <a className="botao sec" href={`?${qs}&p=${pagina + 1}`}>Próximas →</a>}
            </div>
          )}
        </>
      ) : <div className="vazio">Nenhum local encontrado com esses filtros, ou a rede desta região ainda não foi coletada.</div>) : (
        <>
          <h2>Rede já coletada</h2>
          {res.length ? (
            <div className="rolagem"><table>
              <thead><tr><th>Operadora</th><th>UF</th><th className="n">Cidades</th><th className="n">Planos</th><th className="n">Locais</th><th>Atualizado</th><th></th></tr></thead>
              <tbody>{res.map((r) => (
                <tr key={`${r.grupo}${r.uf}`}><td>{r.grupo}</td><td>{r.uf}</td><td className="n">{Number(r.cidades).toLocaleString('pt-BR')}</td>
                  <td className="n">{Number(r.planos).toLocaleString('pt-BR')}</td><td className="n">{Number(r.locais).toLocaleString('pt-BR')}</td>
                  <td>{dataBR(r.atualizado)}</td>
                  <td><a href={`?grupo=${slug(r.grupo)}&uf=${r.uf}`}>ver</a> · <a href={`/api/rede?grupo=${slug(r.grupo)}&uf=${r.uf}`}>baixar</a></td></tr>))}
              </tbody></table></div>
          ) : <div className="vazio">Nenhuma rede coletada ainda. A coleta começa depois da área de comercialização, com Ceará, São Paulo e Rio de Janeiro primeiro.</div>}
        </>
      )}
    </>
  );
}
