import { planilhaPrecos, resolverCidade } from '@/lib/excel';
import { grupoDoSlug } from '@/lib/util';

export const maxDuration = 60;

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const grupo = p.get('grupo') ? grupoDoSlug(p.get('grupo')) : null;
  let cidade = null;
  if (p.get('cidade')) {
    cidade = await resolverCidade(p.get('cidade'), p.get('uf') || null);
    if (!cidade) return new Response(`Cidade "${p.get('cidade')}" ${p.get('uf') ? `(${p.get('uf')}) ` : ''}não encontrada. Volte e confira o nome.`, { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const { buffer, nome } = await planilhaPrecos({ grupo, cidade, tipo: p.get('tipo') || null, admin: p.get('admin') || null });
  return new Response(buffer, { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${nome}"`,
  } });
}
