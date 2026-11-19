import { db, tudo } from '@/lib/db';
import { GRUPOS, FAIXAS, COLS_FAIXA, rotuloFaixa, brl, slug, grupoDoSlug } from '@/lib/util';
import { resolverCidade } from '@/lib/excel';

export const dynamic = 'force-dynamic';
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

export default async function Comparar({ searchParams }) {
  const sp = await searchParams;
  const grupo = sp.grupo ? grupoDoSlug(sp.grupo) : null;
  const faixa = FAIXAS.includes(sp.faixa) ? sp.faixa : '29-33';
  const col = COLS_FAIXA[FAIXAS.indexOf(faixa)];
  const tipo = sp.tipo || 'PME';
  let a = null, b = null, linhas = [], erro = null;
  if (grupo && sp.a && sp.b) {
    [a, b] = await Promise.all([resolverCidade(sp.a, sp.ua || null), resolverCidade(sp.b, sp.ub || null)]);
    if (!a || !b) erro = `Não encontrei ${!a ? sp.a : sp.b}. Confira o nome e a UF.`;
    else {
      const s = db();
      const [la, lb] = await Promise.all([
        tudo(() => s.rpc('planilha_precos', { p_grupo: grupo, p_cidade: a.id, p_tipo: tipo })),
        tudo(() => s.rpc('planilha_precos', { p_grupo: grupo, p_cidade: b.id, p_tipo: tipo })),
      ]);
      const chave = (l) => `${l.plano}|${l.acomodacao}|${l.coparticipacao}|${l.minimo_vidas ?? ''}`;
      const m = new Map();
      for (const l of la) m.set(chave(l), { plano: l.plano, acomodacao: l.acomodacao, copart: l.coparticipacao, vidas: l.minimo_vidas, ta: l.tabela, va: l[col] });
      for (const l of lb) { const k = chave(l); const x = m.get(k) || { plano: l.plano, acomodacao: l.acomodacao, copart: l.coparticipacao, vidas: l.minimo_vidas }; x.tb = l.tabela; x.vb = l[col]; m.set(k, x); }
      linhas = [...m.values()].sort((x, y) => `${x.plano}${x.acomodacao}`.localeCompare(`${y.plano}${y.acomodacao}`));
    }
  }
  return (
    <>
      <h1>Comparar cidades</h1>
      <p className="sub">Mesma operadora em duas praças, plano a plano.</p>
      <form className="filtros" method="get">
        <label>Operadora<select name="grupo" defaultValue={sp.grupo || ''} required><option value="">Escolha</option>{GRUPOS.map((g) => <option key={g} value={slug(g)}>{g}</option>)}</select></label>
        <label>Tipo<select name="tipo" defaultValue={tipo}><option>PME</option><option>PJ</option><option>PF</option></select></label>
        <label>Cidade A<input name="a" defaultValue={sp.a || ''} placeholder="Fortaleza" required /></label>
        <label>UF A<select name="ua" defaultValue={sp.ua || ''}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label>Cidade B<input name="b" defaultValue={sp.b || ''} placeholder="São Paulo" required /></label>
        <label>UF B<select name="ub" defaultValue={sp.ub || ''}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label>Faixa<select name="faixa" defaultValue={faixa}>{FAIXAS.map((f) => <option key={f} value={f}>{rotuloFaixa(f)}</option>)}</select></label>
        <button type="submit">Comparar</button>
      </form>
      {erro && <div className="aviso">{erro}</div>}
      {a && b && (linhas.length ? (
        <div className="rolagem"><table>
          <thead><tr><th>Plano</th><th>Acomodação</th><th>Coparticipação</th><th className="n">Mín. vidas</th><th className="n">{a.nome}/{a.uf}</th><th className="n">{b.nome}/{b.uf}</th><th className="n">Diferença</th></tr></thead>
          <tbody>{linhas.map((l, i) => { const d = l.va && l.vb ? ((l.vb - l.va) / l.va) * 100 : null; return (
            <tr key={i}><td>{l.plano}</td><td>{l.acomodacao}</td><td>{l.copart}</td><td className="n">{l.vidas ?? '—'}</td>
              <td className="n" title={l.ta}>{brl(l.va)}</td><td className="n" title={l.tb}>{brl(l.vb)}</td>
              <td className="n">{d == null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1).replace('.', ',')}%`}</td></tr>); })}
          </tbody></table></div>
      ) : <div className="vazio">Sem preços para comparar nessas cidades (ainda não conferidos ou a operadora não vende lá).</div>)}
    </>
  );
}
