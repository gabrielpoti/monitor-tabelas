import { db } from '@/lib/db';

const VAZIO = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

export async function GET(req, { params }) {
  const { grupo } = await params;
  const { data } = await db().storage.from('logos').download(`${grupo.replace(/[^a-z0-9-]/g, '')}.png`);
  if (!data) return new Response(VAZIO, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'private, max-age=300' } });
  return new Response(await data.arrayBuffer(), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=300' } });
}
