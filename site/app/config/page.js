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
  const [{ data: arquivos }, { data: st }, loginKey] = await Promise.all([
    s.storage.from('logos').list('', { limit: 100 }),
    s.from('oauth_state').select('expires_at,updated_at,refresh_token').eq('id', 'cotador').maybeSingle(),
    config('login_key'),
  ]);
  const tem = new Set((arquivos || []).map((a) => a.name));
  const v = Date.now();
  const linkLogin = `${process.env.SUPABASE_URL || 'https://knvtovsrbyhpcgirgtbl.supabase.co'}/functions/v1/cotador-auth?k=${loginKey}`;
  return (
    <>
      <h1>Logos e conexão</h1>
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

      <h2>Conexão com o Cotador</h2>
      <div className="cartao">
        <p>{st?.refresh_token ? <span className="chip ok">conectado</span> : <span className="chip erro">sem login</span>} Última renovação: {dataHoraBR(st?.updated_at)}</p>
        <p className="pequeno">Se o monitor avisar que o acesso caiu, refaça o login (abre a tela de autorização do Cotador; escolha "Somente consultar").</p>
        <a className="botao sec" href={linkLogin} target="_blank" rel="noreferrer">Refazer login no Cotador</a>
      </div>

      <h2>Botão "Rodar agora"</h2>
      <div className="cartao pequeno">
        {process.env.GITHUB_TOKEN ? <span className="chip ok">configurado</span> : <>Para rodar o monitor pelo painel, crie um token no GitHub (Settings → Developer settings → Fine-grained tokens, só o repositório monitor-tabelas, permissão <b>Actions: Read and write</b>) e salve na Vercel como <b>GITHUB_TOKEN</b>.</>}
      </div>
    </>
  );
}
