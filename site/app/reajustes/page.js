import { db, tudo } from '@/lib/db';
import { dataBR, grupoDe, GRUPOS, slug, grupoDoSlug } from '@/lib/util';

export const dynamic = 'force-dynamic';

export default async function Reajustes({ searchParams }) {
  const sp = await searchParams;
  const grupo = sp.grupo ? grupoDoSlug(sp.grupo) : null;
  const s = db();
  const desde = new Date(Date.now() - 30 * 864e5).toISOString();
  const precos = await tudo(() => s.from('precos').select('tabela_id,uf,plano,novo_preco_em').not('novo_preco_em', 'is', null).gte('novo_preco_em', desde).order('novo_preco_em'));
  const ids = [...new Set(precos.map((p) => p.tabela_id))];
  const tabs = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await s.from('tabelas').select('id,nome,operadora,administradora,tipo_tabela').in('id', ids.slice(i, i + 150));
    for (const t of data || []) tabs.set(t.id, t);
  }
  // agrupa: data → tabela/UF → planos
  const porData = new Map();
  for (const p of precos) {
    const t = tabs.get(p.tabela_id);
    if (grupo && grupoDe(t?.operadora) !== grupo) continue;
    const d = p.novo_preco_em.slice(0, 10);
    if (!porData.has(d)) porData.set(d, new Map());
    const k = `${p.tabela_id}|${p.uf}`;
    if (!porData.get(d).has(k)) porData.get(d).set(k, { t, uf: p.uf, id: p.tabela_id, planos: new Set() });
    porData.get(d).get(k).planos.add(p.plano);
  }
  const hoje = new Date().toISOString().slice(0, 10);
  return (
    <>
      <h1>Calendário de reajustes</h1>
      <p className="sub">Preços novos agendados no cotador (próximos e dos últimos 30 dias), para avisar o cliente antes de subir.</p>
      <form className="filtros" method="get">
        <label>Operadora<select name="grupo" defaultValue={sp.grupo || ''}><option value="">Todas</option>{GRUPOS.map((g) => <option key={g} value={slug(g)}>{g}</option>)}</select></label>
        <button type="submit">Filtrar</button>
      </form>
      {porData.size ? [...porData.entries()].map(([d, itens]) => (
        <div key={d} className="cartao" style={{ marginBottom: '.75rem', opacity: d < hoje ? 0.7 : 1 }}>
          <h3>{dataBR(`${d}T12:00:00`)} {d < hoje ? <span className="chip">já vigente</span> : <span className="chip alerta">agendado</span>}</h3>
          <table><tbody>{[...itens.values()].map((x) => (
            <tr key={`${x.id}${x.uf}`}><td><a href={`/tabela/${x.id}?uf=${x.uf}`}>{x.t?.nome || x.id}</a><br /><span className="pequeno">{grupoDe(x.t?.operadora)} · {x.t?.administradora} · {x.t?.tipo_tabela}</span></td>
              <td>{x.uf}</td><td className="pequeno">{[...x.planos].join(', ')}</td></tr>))}
          </tbody></table>
        </div>
      )) : <div className="vazio">Nenhum preço novo agendado no momento.</div>}
    </>
  );
}
