export default async function Login({ searchParams }) {
  const sp = await searchParams;
  return (
    <div style={{ maxWidth: 360, margin: '12vh auto' }} className="cartao">
      <h1>Monitor de Tabelas</h1>
      <p className="sub">Acesso restrito.</p>
      {sp.semSenha && <div className="aviso">O site ainda não tem senha configurada (variável SITE_PASSWORD na Vercel).</div>}
      {sp.erro && <div className="aviso">Senha incorreta.</div>}
      <form action="/api/login" method="post" style={{ display: 'grid', gap: '.75rem' }}>
        <input type="hidden" name="volta" value={sp.volta || '/'} />
        <label>Senha<input type="password" name="senha" autoComplete="current-password" required autoFocus /></label>
        <button type="submit">Entrar</button>
      </form>
    </div>
  );
}
