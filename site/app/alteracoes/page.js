import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { aplicarFiltrosMudancas } from '@/lib/excel';
import { GRUPOS, slug, grupoDoSlug, grupoDe, TIPOS_MUDANCA, dataHoraBR } from '@/lib/util';

export const dynamic = 'force-dynamic';
const POR_PAGINA = 100;

async function marcar(form) {
  'use server';
  const ids = form.getAll('id').map(Number).filter(Boolean);
  const todas = form.get('todas') === '1';
  const lida = form.get('lida') !== '0';
  let q = db().from('mudancas').update({ lida });
  if (todas) q = q.eq('lida', !lida); else if (ids.length) q = q.in('id', ids); else return;
  await q;
  revalidatePath('/alteracoes');
}

export default async function Alteracoes({ searchParams }) {
  const sp = await searchParams;
  const filtros = { grupo: sp.grupo ? grupoDoSlug(sp.grupo) : null, tipo: sp.tipo || null, de: sp.de || null, ate: sp.ate || null, lida: sp.lida || null };
  const pagina = Math.max(1, Number(sp.p) || 1);
  const { data, count } = await aplicarFiltrosMudancas(db().from('mudancas').select('id,tipo,operadora,uf,tabela_id,descricao,detectado_em,lida', { count: 'exact' }), filtros)
    .order('id', { ascending: false }).range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  const qsBase = new URLSearchParams(Object.entries({ grupo: sp.grupo, tipo: sp.tipo, de: sp.de, ate: sp.ate, lida: sp.lida }).filter(([, v]) => v)).toString();
  const paginas = Math.ceil((count || 0) / POR_PAGINA);

  return (
    <>
      <h1>Alterações</h1>
      <p className="sub">{count || 0} alteração(ões) no filtro. As não lidas ficam destacadas.</p>
      <form className="filtros" method="get">
        <label>Operadora<select name="grupo" defaultValue={sp.grupo || ''}><option value="">Todas</option>{GRUPOS.map((g) => <option key={g} value={slug(g)}>{g}</option>)}</select></label>
        <label>Tipo<select name="tipo" defaultValue={sp.tipo || ''}><option value="">Todos</option>{Object.entries(TIPOS_MUDANCA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>De<input type="date" name="de" defaultValue={sp.de || ''} /></label>
        <label>Até<input type="date" name="ate" defaultValue={sp.ate || ''} /></label>
        <label>Situação<select name="lida" defaultValue={sp.lida || ''}><option value="">Todas</option><option value="nao">Não lidas</option><option value="sim">Lidas</option></select></label>
        <button type="submit">Filtrar</button>
        <a className="botao sec" href={`/api/alteracoes?${qsBase}`}>Baixar planilha</a>
      </form>

      <form action={marcar}>
        <div className="linha" style={{ marginBottom: '.5rem' }}>
          <button type="submit" name="lida" value="1">Marcar selecionadas como lidas</button>
          <button type="submit" className="sec" name="todas" value="1">Marcar todas como lidas</button>
        </div>
        {(data || []).length ? (
          <div className="rolagem"><table>
            <thead><tr><th></th><th>Data</th><th>Operadora</th><th>Tipo</th><th>Descrição</th></tr></thead>
            <tbody>{data.map((m) => (
              <tr key={m.id} className={m.lida ? '' : 'naolida'}>
                <td><input type="checkbox" name="id" value={m.id} aria-label="selecionar" /></td>
                <td className="pequeno" style={{ whiteSpace: 'nowrap' }}>{dataHoraBR(m.detectado_em)}</td>
                <td>{grupoDe(m.operadora)}{m.uf && <span className="pequeno"> · {m.uf}</span>}</td>
                <td><span className="chip">{TIPOS_MUDANCA[m.tipo] || m.tipo}</span></td>
                <td>{m.tabela_id ? <a href={`/tabela/${m.tabela_id}${m.uf ? `?uf=${m.uf}` : ''}`} style={{ color: 'inherit' }}>{m.descricao}</a> : m.descricao}</td>
              </tr>))}
            </tbody></table></div>
        ) : <div className="vazio">Nenhuma alteração neste filtro.</div>}
      </form>
      {paginas > 1 && (
        <div className="linha" style={{ marginTop: '.75rem' }}>
          {pagina > 1 && <a className="botao sec" href={`?${qsBase}&p=${pagina - 1}`}>← Anteriores</a>}
          <span className="pequeno">Página {pagina} de {paginas}</span>
          {pagina < paginas && <a className="botao sec" href={`?${qsBase}&p=${pagina + 1}`}>Próximas →</a>}
        </div>
      )}
    </>
  );
}
