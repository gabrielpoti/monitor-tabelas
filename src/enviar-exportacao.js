// Sobe as planilhas de saida/ para o bucket privado "exportacoes" do Supabase e guarda links assinados
// (válidos por 7 dias) em config.ultima_exportacao. Nada de dados vai para o GitHub.
import { readdirSync, readFileSync } from 'node:fs';
import { db, setConfig } from './db.js';

const links = [];
for (const nome of readdirSync('saida').filter((f) => f.endsWith('.xlsx'))) {
  const caminho = `${new Date().toISOString().slice(0, 10)}/${nome}`;
  const { error } = await db.storage.from('exportacoes').upload(caminho, readFileSync(`saida/${nome}`), {
    upsert: true, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  if (error) throw new Error(`Upload ${nome}: ${error.message}`);
  const { data, error: e2 } = await db.storage.from('exportacoes').createSignedUrl(caminho, 7 * 86400, { download: nome });
  if (e2) throw new Error(`Link ${nome}: ${e2.message}`);
  links.push({ nome, url: data.signedUrl, em: new Date().toISOString() });
}
await setConfig('ultima_exportacao', JSON.stringify(links));
console.log(`${links.length} planilha(s) enviada(s).`);
