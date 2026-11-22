// Checagem de reserva (Vercel Cron): se o agendamento do GitHub não rodou, dispara a execução.
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

const REPO = process.env.GITHUB_REPO || 'gabrielpoti/monitor-tabelas';
// Janela em que uma execução já feita conta como "rodou no horário".
const JANELA_H = { diario: 10, semanal: 60, rede: 60, descontos: 140 }; // diário: 10h, para não pular o dia quando o da véspera atrasou

const gh = (caminho, init = {}) => fetch(`https://api.github.com/repos/${REPO}${caminho}`, {
  ...init,
  headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(init.headers || {}) },
});

export async function GET(req) {
  const modo = req.nextUrl.searchParams.get('modo');
  if (!JANELA_H[modo]) return NextResponse.json({ erro: 'modo inválido' }, { status: 400 });
  if (!process.env.GITHUB_TOKEN) return NextResponse.json({ ok: false, motivo: 'sem GITHUB_TOKEN' });

  // 1) Já existe execução desse modo recente no banco?
  const desde = new Date(Date.now() - JANELA_H[modo] * 3600e3).toISOString();
  const { data: recentes } = await db().from('execucoes').select('id,status,inicio').eq('modo', modo).in('status', ['ok', 'rodando']).gte('inicio', desde).limit(1);
  if (recentes?.length) return NextResponse.json({ ok: true, acao: 'nada', motivo: `já rodou (#${recentes[0].id})` });

  // 2) Há execução na fila ou rodando no GitHub? (pode ser o agendamento esperando outra terminar)
  for (const status of ['queued', 'in_progress', 'waiting', 'pending']) {
    const r = await gh(`/actions/workflows/monitor.yml/runs?status=${status}&per_page=5`);
    const j = r.ok ? await r.json() : { total_count: 0 };
    if (j.total_count > 0) {
      // se a que está rodando é de outro modo, o agendamento deste modo pode não ter sido criado: dispara mesmo assim,
      // a fila do GitHub (concurrency) garante que uma espera a outra.
      const agendadaEmFila = (j.workflow_runs || []).some((w) => w.event === 'schedule' && status !== 'in_progress');
      if (agendadaEmFila) return NextResponse.json({ ok: true, acao: 'nada', motivo: 'agendamento do GitHub já está na fila' });
    }
  }

  // 3) Dispara
  const r = await gh('/actions/workflows/monitor.yml/dispatches', { method: 'POST', body: JSON.stringify({ ref: 'main', inputs: { modo } }) });
  return NextResponse.json({ ok: r.ok, acao: 'disparou', modo, status: r.status });
}
