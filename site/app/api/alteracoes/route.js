import { planilhaAlteracoes } from '@/lib/excel';
import { grupoDoSlug } from '@/lib/util';

export const maxDuration = 60;

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const { buffer, nome } = await planilhaAlteracoes({
    grupo: p.get('grupo') ? grupoDoSlug(p.get('grupo')) : null,
    tipo: p.get('tipo') || null, de: p.get('de') || null, ate: p.get('ate') || null, lida: p.get('lida') || null,
  });
  return new Response(buffer, { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${nome}"`,
  } });
}
