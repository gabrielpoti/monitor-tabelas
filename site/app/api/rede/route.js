import { planilhaRede, contarRede, LIMITE_LINHAS } from '@/lib/rede';
import { grupoDoSlug } from '@/lib/util';

export const maxDuration = 60;

const texto = (msg, status = 400) => new Response(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export async function GET(req) {
  const p = req.nextUrl.searchParams;
  const f = {
    grupo: p.get('grupo') ? grupoDoSlug(p.get('grupo')) : null, uf: p.get('uf') || null, cidade: p.get('cidade') || null,
    tipo: p.get('tipo') || null, admin: p.get('admin') || null, plano: p.get('plano') || null, q: p.get('q') || null,
    tipoTabela: p.get('tipoTabela') || null,
  };
  if (!f.uf && !f.cidade && !f.q) return texto('Escolha pelo menos uma UF ou uma cidade para baixar a rede.');
  const n = await contarRede(f);
  if (n > LIMITE_LINHAS) return texto(`Esse filtro tem ${n.toLocaleString('pt-BR')} linhas, mais do que cabe numa planilha. Escolha uma operadora ou uma cidade e tente de novo.`);
  const { buffer, nome } = await planilhaRede(f);
  return new Response(buffer, { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${nome}"`,
  } });
}
