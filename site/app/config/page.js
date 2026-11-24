import { revalidatePath } from 'next/cache';
import { db, config } from '@/lib/db';
import { GRUPOS, slug, dataHoraBR } from '@/lib/util';

export const dynamic = 'force-dynamic';

async function enviarLogo(form) {
  'use server';
  const grupo = String(form.get('grupo'));
  const arq = form.get('arquivo');
  if (!GRUPOS.map(slug).includes(grupo) || !arq || typeof arq === 'string' || !arq.size) return;
  if (arq.type !== 'image/png' || arq.size > 2_000_000) return;
  await db().storage.from('logos').upload(`${grupo}.png`, Buffer.from(await arq.arrayBuffer()), { contentType: 'image/png', upsert: true });
  revalidatePath('/config');
}

async function removerLogo(form) {
  'use server';
  const grupo = String(form.get('grupo'));
  if (!GRUPOS.map(slug).includes(grupo)) return;
  await db().storage.from('logos').remove([`${grupo}.png`]);
  revalidatePath('/config');
}

export default async function Config() {
  const s = db();
  const [{ data: arquivos }, { data: contas }, loginKey] = await Promise.all([
    s.storage.from('logos').list('', { limit: 100 }),
    s.from('oauth_state').select('id,conta_nome,updated_at,refresh_token').like('id', 'cotador%'),
    config('login_key'),
  ]);
  const tem = new Set((arquivos || []).map((a) => a.name));
  const v = Date.now();
  const linkLogin = `${process.env.SUPABASE_URL || 'https://knvtovsrbyhpcgirgtbl.supabase.co'}/functions/v1/cotador-auth?k=${loginKey}`;
  return (
    <>
      <h1>Logos e contas</h1>
      <p className="sub">Logos das operadoras usados no site e no topo das planilhas. Envie PNG (até 2 MB), de preferência com fundo transparente.</p>
      <div className="grade">
        {GRUPOS.map((g) => { const sg = slug(g); return (
          <div key={g} className="cartao">
            <h3>{g}</h3>
            <div style={{ height: 50, display: 'flex', alignItems: 'center' }}>
              {tem.has(`${sg}.png`) ? <img src={`/api/logo/${sg}?v=${v}`} alt={g} style={{ maxHeight: 44, maxWidth: '100%' }} /> : <span className="pequeno">sem logo</span>}
            </div>
            <form action={enviarLogo} className="linha" style={{ marginTop: '.5rem' }}>
              <input type="hidden" name="grupo" value={sg} />
              <input type="file" name="arquivo" accept="image/png" required style={{ maxWidth: '100%' }} />
              <button type="submit">Enviar</button>
            </form>
            {tem.has(`${sg}.png`) && <form action={removerLogo}><input type="hidden" name="grupo" value={sg} /><button className="sec" type="submit" style={{ marginTop: '.4rem' }}>Remover</button></form>}
          </div>); })}
      </div>

      <h2>Contas do Cotador</h2>
      <p className="sub">O monitor divide as consultas entre as contas conectadas: cada conta extra aumenta o ritmo. A conta principal também define quais tabelas aparecem em cada cidade.</p>
      <div className="grade">
        {[['', 'cotador', 'Conta principal'], ['2', 'cotador2', 'Conta extra 2'], ['3', 'cotador3', 'Conta extra 3']].map(([c, id, titulo]) => {
          const st = (contas || []).find((x) => x.id === id);
          const ok = !!st?.refresh_token;
          return (
            <div key={id} className="cartao">
              <h3>{titulo}</h3>
              <p>{ok ? <span className="chip ok">conectada</span> : <span className="chip erro">sem login</span>} {ok && <b>{st.conta_nome || 'nome aparece após a próxima rodada'}</b>}</p>
              {ok && <p className="pequeno">Última renovação: {dataHoraBR(st.updated_at)}</p>}
              <p className="pequeno">Antes de conectar outra conta, saia do Cotador neste navegador (ou use uma janela anônima). Na autorização, escolha "Somente consultar".</p>
              <a className="botao sec" href={`${linkLogin}${c ? `&c=${c}` : ''}`} target="_blank" rel="noreferrer">{ok ? 'Refazer login' : 'Conectar conta'}</a>
            </div>
          );
        })}
      </div>

      <h2>Botão "Rodar agora"</h2>
      <div className="cartao pequeno">
        {process.env.GITHUB_TOKEN ? <span className="chip ok">configurado</span> : <>Para rodar o monitor pelo painel, crie um token no GitHub (Settings → Developer settings → Fine-grained tokens, só o repositório monitor-tabelas, permissão <b>Actions: Read and write</b>) e salve na Vercel como <b>GITHUB_TOKEN</b>.</>}
      </div>
    </>
  );
}
