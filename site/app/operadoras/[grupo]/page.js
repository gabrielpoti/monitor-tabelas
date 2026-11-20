import { notFound } from 'next/navigation';
import { db, tudo } from '@/lib/db';
import { grupoDoSlug } from '@/lib/util';
import Baixar from '../../Baixar';

export const dynamic = 'force-dynamic';

export default async function Grupo({ params, searchParams }) {
  const { grupo: g } = await params;
  const grupo = grupoDoSlug(g);
  if (!grupo) notFound();
  const sp = await searchParams;
  const todas = await tudo(() => db().from('v_tabelas').select('id,nome,operadora,administradora,tipo_tabela,minimo_vidas,exige_entidade,planos,ufs,cidades,ativa,primeira_vez').eq('grupo', grupo).order('nome'));
  const admins = [...new Set(todas.map((t) => t.administradora).filter(Boolean))].sort();
  const ufs = [...new Set(todas.flatMap((t) => t.ufs || []))].sort();
  const busca = (sp.q || '').toLowerCase();
  const lista = todas.filter((t) => (sp.inativas ? true : t.ativa)
    && (!sp.tipo || t.tipo_tabela === sp.tipo)
    && (!sp.admin || (sp.admin === '__administradoras__' ? t.administradora !== 'direto' : t.administradora === sp.admin))
    && (!sp.uf || (t.ufs || []).includes(sp.uf))
    && (!busca || t.nome.toLowerCase().includes(busca) || (t.planos || []).some((p) => p.nome.toLowerCase().includes(busca))));

  return (
    <>
      <div className="linha"><img className="logo-op" src={`/api/logo/${g}`} alt="" /><h1>{grupo}</h1></div>
      <p className="sub">{lista.length} de {todas.length} tabela(s).</p>

      <form className="filtros" method="get">
        <label>Buscar<input name="q" defaultValue={sp.q || ''} placeholder="tabela ou plano" /></label>
        <label>Tipo<select name="tipo" defaultValue={sp.tipo || ''}><option value="">Todos</option><option>PME</option><option>PJ</option><option>PF</option></select></label>
        <label>Administradora<select name="admin" defaultValue={sp.admin || ''}><option value="">Todas (direto + administradoras)</option><option value="direto">Só direto da operadora</option><option value="__administradoras__">Só administradoras (todas)</option>{admins.filter((a) => a !== 'direto').map((a) => <option key={a}>{a}</option>)}</select></label>
        <label>UF<select name="uf" defaultValue={sp.uf || ''}><option value="">Todas</option>{ufs.map((u) => <option key={u}>{u}</option>)}</select></label>
        <label className="linha" style={{ display: 'flex' }}><input type="checkbox" name="inativas" value="1" defaultChecked={!!sp.inativas} /> incluir removidas</label>
        <button type="submit">Filtrar</button>
      </form>

      <Baixar grupoSlug={g} tipo={sp.tipo} admin={sp.admin} />

      {lista.length ? (
        <div className="rolagem"><table>
          <thead><tr><th>Tabela</th><th>Administradora</th><th>Tipo</th><th className="n">Mín. vidas</th><th className="n">Planos</th><th>UFs</th><th className="n">Cidades</th></tr></thead>
          <tbody>{lista.map((t) => (
            <tr key={t.id}>
              <td><a href={`/tabela/${t.id}`}>{t.nome}</a>{!t.ativa && <span className="chip erro">removida</span>}{t.exige_entidade && <span className="chip">exige entidade</span>}</td>
              <td>{t.administradora}</td><td>{t.tipo_tabela}</td><td className="n">{t.minimo_vidas ?? '—'}</td>
              <td className="n">{(t.planos || []).length}</td><td className="pequeno">{(t.ufs || []).join(', ')}</td><td className="n">{t.cidades}</td>
            </tr>))}
          </tbody></table></div>
      ) : <div className="vazio">Nenhuma tabela encontrada. Se a 1ª carga da área ainda está rodando, as tabelas vão aparecendo conforme as cidades são varridas.</div>}
    </>
  );
}
