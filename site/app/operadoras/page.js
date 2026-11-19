import { tudo, db } from '@/lib/db';
import { GRUPOS, slug } from '@/lib/util';

export const dynamic = 'force-dynamic';

export default async function Operadoras() {
  const tabelas = await tudo(() => db().from('v_tabelas').select('grupo,ativa,cidades,ufs'));
  const info = Object.fromEntries(GRUPOS.map((g) => [g, { n: 0, ufs: new Set() }]));
  for (const t of tabelas) if (t.ativa && info[t.grupo]) { info[t.grupo].n++; (t.ufs || []).forEach((u) => info[t.grupo].ufs.add(u)); }
  return (
    <>
      <h1>Operadoras</h1>
      <p className="sub">Escolha uma operadora para ver as tabelas e baixar planilhas.</p>
      <div className="grade">
        {GRUPOS.map((g) => (
          <a key={g} href={`/operadoras/${slug(g)}`} className="cartao" style={{ color: 'inherit' }}>
            <div className="linha"><img className="logo-op" src={`/api/logo/${slug(g)}`} alt="" /><h3>{g}</h3></div>
            <div className="rotulo">{info[g].n} tabela(s) ativa(s) · {info[g].ufs.size} UF(s)</div>
          </a>
        ))}
      </div>
    </>
  );
}
