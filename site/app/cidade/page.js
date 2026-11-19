import { db, tudo } from '@/lib/db';
import { GRUPOS, brl, rotuloFaixa, FAIXAS, COLS_FAIXA } from '@/lib/util';
import Baixar from '../Baixar';

export const dynamic = 'force-dynamic';
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

export default async function PorCidade({ searchParams }) {
  const sp = await searchParams;
  const s = db();
  const faixa = FAIXAS.includes(sp.faixa) ? sp.faixa : '29-33';
  let candidatas = [], cidade = null;
  if (sp.id) {
    const { data } = await s.from('cidades').select('id,nome,uf,uf_id').eq('id', Number(sp.id)).maybeSingle();
    cidade = data;
  } else if (sp.q) {
    let q = s.from('cidades').select('id,nome,uf,uf_id').ilike('nome', `${sp.q.trim()}%`).order('nome').limit(30);
    if (sp.uf) q = q.eq('uf', sp.uf);
    candidatas = (await q).data || [];
    const exata = candidatas.filter((c) => c.nome.toLowerCase() === sp.q.trim().toLowerCase());
    if (exata.length === 1 || candidatas.length === 1) cidade = exata[0] || candidatas[0];
  }

  let porGrupo = new Map(), precoMin = new Map(), redeN = new Map();
  if (cidade) {
    const ids = (await tudo(() => s.from('tabela_cidade').select('tabela_id').eq('cidade_id', cidade.id))).map((v) => v.tabela_id);
    const tabelas = [];
    for (let i = 0; i < ids.length; i += 150) tabelas.push(...await tudo(() => s.from('v_tabelas').select('id,nome,grupo,administradora,tipo_tabela,minimo_vidas,planos,ativa').in('id', ids.slice(i, i + 150)).eq('ativa', true)));
    for (const g of GRUPOS) porGrupo.set(g, tabelas.filter((t) => t.grupo === g).sort((a, b) => a.nome.localeCompare(b.nome)));
    const linhas = await tudo(() => s.rpc('planilha_precos', { p_cidade: cidade.id }));
    const col = COLS_FAIXA[FAIXAS.indexOf(faixa)];
    for (const l of linhas) if (l[col] != null) { const v = Number(l[col]); if (!precoMin.has(l.tabela_id) || v < precoMin.get(l.tabela_id)) precoMin.set(l.tabela_id, v); }
    const rede = await tudo(() => s.from('rede').select('tabela_id,total').eq('cidade_id', cidade.id));
    for (const r of rede) redeN.set(r.tabela_id, Math.max(redeN.get(r.tabela_id) || 0, r.total || 0));
  }

  return (
    <>
      <h1>Por cidade</h1>
      <p className="sub">O que dá para vender em uma cidade, por operadora.</p>
      <form className="filtros" method="get">
        <label>Cidade<input name="q" defaultValue={sp.q || cidade?.nome || ''} placeholder="ex.: Juazeiro do Norte" required /></label>
        <label>UF<select name="uf" defaultValue={sp.uf || cidade?.uf || ''}><option value="">Todas</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label>Faixa do preço<select name="faixa" defaultValue={faixa}>{FAIXAS.map((f) => <option key={f} value={f}>{rotuloFaixa(f)}</option>)}</select></label>
        <button type="submit">Buscar</button>
      </form>

      {!cidade && candidatas.length > 1 && (
        <div className="cartao"><b>Qual cidade?</b><div className="linha" style={{ marginTop: '.5rem' }}>
          {candidatas.map((c) => <a key={c.id} className="chip" href={`?id=${c.id}&faixa=${faixa}`}>{c.nome}/{c.uf}</a>)}
        </div></div>
      )}
      {!cidade && sp.q && !candidatas.length && <div className="vazio">Cidade não encontrada no cotador.</div>}

      {cidade && (<>
        <h2>{cidade.nome}/{cidade.uf}</h2>
        <Baixar cidadePadrao={cidade.nome} ufPadrao={cidade.uf} />
        {GRUPOS.map((g) => { const ts = porGrupo.get(g) || []; return (
          <div key={g} style={{ marginBottom: '1rem' }}>
            <h2>{g} <span className="pequeno">({ts.length})</span></h2>
            {ts.length ? (
              <div className="rolagem"><table>
                <thead><tr><th>Tabela</th><th>Administradora</th><th>Tipo</th><th className="n">Mín. vidas</th><th>Planos</th><th className="n">Menor preço {rotuloFaixa(faixa)}</th><th className="n">Rede</th></tr></thead>
                <tbody>{ts.map((t) => (
                  <tr key={t.id}><td><a href={`/tabela/${t.id}?uf=${cidade.uf}&cidade=${cidade.id}`}>{t.nome}</a></td><td>{t.administradora}</td><td>{t.tipo_tabela}</td>
                    <td className="n">{t.minimo_vidas ?? '—'}</td><td className="pequeno">{(t.planos || []).map((p) => p.nome).join(', ')}</td>
                    <td className="n">{brl(precoMin.get(t.id))}</td><td className="n">{redeN.has(t.id) ? `${redeN.get(t.id)} locais` : '—'}</td></tr>))}
                </tbody></table></div>
            ) : <div className="vazio">Nenhuma tabela desta operadora nesta cidade (ou a cidade ainda não foi varrida).</div>}
          </div>); })}
      </>)}
    </>
  );
}
