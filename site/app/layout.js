import './globals.css';
import { cookies } from 'next/headers';
import { COOKIE } from '@/lib/auth';
import { db } from '@/lib/db';

export const metadata = { title: 'Monitor de Tabelas', description: 'Tabelas, coparticipação, carência, área e rede das operadoras' };
export const viewport = { width: 'device-width', initialScale: 1 };

async function naoLidas() {
  try {
    const { count } = await db().from('mudancas').select('id', { count: 'exact', head: true }).eq('lida', false);
    return count || 0;
  } catch { return 0; }
}

export default async function Layout({ children }) {
  const logado = (await cookies()).has(COOKIE);
  const n = logado ? await naoLidas() : 0;
  return (
    <html lang="pt-BR">
      <body>
        {logado && (
          <nav className="topo"><div className="topo-in">
            <a href="/" className="marca">Monitor de Tabelas</a>
            <a className="item" href="/">Painel</a>
            <a className="item" href="/operadoras">Operadoras</a>
            <a className="item" href="/cidade">Por cidade</a>
            <a className="item" href="/comparar">Comparar</a>
            <a className="item" href="/rede">Rede</a>
            <a className="item" href="/alteracoes">Alterações{n > 0 && <span className="badge">{n > 99 ? '99+' : n}</span>}</a>
            <a className="item" href="/reajustes">Reajustes</a>
            <a className="item" href="/config">Logos</a>
            <form action="/api/logout" method="post"><button className="sec" type="submit">Sair</button></form>
          </div></nav>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
