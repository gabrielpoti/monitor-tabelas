// Recebe os dados da extensão do Painel do Corretor e grava no banco do site.
// POST JSON { k: <extensao_key>, tipo: "painel_cenarios" | "painel_precos" | "status", ... }
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...cors } });
const brl = (v: number) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a: number, b: number) => (a ? ((b - a) / a) * 100 : 0);

let chaveCache: string | null = null;
async function chaveValida(k: unknown) {
  if (!chaveCache) {
    const { data } = await db.from("config").select("valor").eq("chave", "extensao_key").single();
    chaveCache = data?.valor ?? null;
  }
  return !!chaveCache && k === chaveCache;
}

// ---------------- Painel do Corretor ----------------
const MOD: Record<number, string> = { 1: "PF", 2: "PME", 3: "Adesão" };
const ACOM: Record<number, string> = { 0: "Enfermaria", 1: "Apartamento", 2: "Ambulatorial", 3: "Ambulatorial" };
const nomeCen = (c: any) => `${c.plano} · ${c.tabela} (${MOD[c.modalidade] || c.modalidade}${c.administradora && c.administradora !== c.operadora ? " · " + c.administradora : ""})`;

async function lerChaves(tabela: string, col: string, valores: string[], extra?: (q: any) => any) {
  const out: any[] = [];
  for (let i = 0; i < valores.length; i += 300) {
    let q = db.from(tabela).select("*").in(col, valores.slice(i, i + 300));
    if (extra) q = extra(q);
    const { data } = await q.limit(10000);
    out.push(...(data || []));
  }
  return out;
}

async function painelCenarios(b: any) {
  const uf = String(b.uf || "").toUpperCase().slice(0, 2), agora = new Date().toISOString();
  const itens: any[] = (b.itens || []).filter((c: any) => c?.key);
  if (!uf) return { ok: false, motivo: "uf" };
  for (let i = 0; i < itens.length; i += 500) {
    await db.from("painel_cenarios").upsert(itens.slice(i, i + 500).map((c) => ({ ...c, ultima_vez: agora, ativo: true })), { onConflict: "key" });
  }
  // o que este estado tinha antes
  const antes: string[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await db.from("painel_cenario_uf").select("key").eq("uf", uf).range(de, de + 999);
    antes.push(...(data || []).map((x: any) => x.key));
    if (!data || data.length < 1000) break;
  }
  const novos = new Set(itens.map((c) => c.key)), velhos = new Set(antes);
  const entrou = itens.filter((c) => !velhos.has(c.key));
  const saiu = antes.filter((k) => !novos.has(k));
  for (let i = 0; i < itens.length; i += 500)
    await db.from("painel_cenario_uf").upsert(itens.slice(i, i + 500).map((c) => ({ key: c.key, uf, ultima_vez: agora })), { onConflict: "key,uf" });
  const mudancas: any[] = [];
  if (antes.length && !b.parcial) { // primeira varredura do estado só grava a base
    const porOp = (lst: any[]) => { const m = new Map<string, any[]>(); for (const c of lst) { if (!m.has(c.operadora)) m.set(c.operadora, []); m.get(c.operadora)!.push(c); } return m; };
    for (const [op, lst] of porOp(entrou)) mudancas.push({ tipo: "painel_novo", operadora: op, uf, chave: `painel|${uf}|${op}|novo`, notificado: true, detectado_em: agora,
      descricao: `Painel do Corretor – ${op} (${uf}): ${lst.length} plano(s)/tabela(s) novo(s). Ex.: ${nomeCen(lst[0])}`,
      depois: lst.map((c) => ({ key: c.key, nome: nomeCen(c), vidas: `${c.vidas_min}–${c.vidas_max}`, copart: c.coparticipacao ? (c.copart_tipo || "com") : "sem" })) });
    if (saiu.length) {
      const info = new Map((await lerChaves("painel_cenarios", "key", saiu)).map((c: any) => [c.key, c]));
      const lst = saiu.map((k) => info.get(k) || { key: k, operadora: "?", plano: k, tabela: "", modalidade: 0 });
      for (const [op, l] of porOp(lst)) mudancas.push({ tipo: "painel_removido", operadora: op, uf, chave: `painel|${uf}|${op}|saiu`, notificado: true, detectado_em: agora,
        descricao: `Painel do Corretor – ${op} (${uf}): ${l.length} plano(s)/tabela(s) saíram. Ex.: ${nomeCen(l[0])}`,
        antes: l.map((c: any) => ({ key: c.key, nome: nomeCen(c) })) });
    }
    if (mudancas.length) await db.from("mudancas").insert(mudancas);
  }
  if (saiu.length && !b.parcial) for (let i = 0; i < saiu.length; i += 200) await db.from("painel_cenario_uf").delete().eq("uf", uf).in("key", saiu.slice(i, i + 200));
  return { ok: true, base: !antes.length, total: itens.length, entrou: antes.length ? entrou.length : 0, saiu: antes.length ? saiu.length : 0,
    resumo: mudancas.map((m) => m.descricao) };
}

async function painelPrecos(b: any) {
  const agora = new Date().toISOString(), hoje = agora.slice(0, 10);
  const itens: any[] = (b.itens || []).filter((x: any) => x?.key && x.faixas && Object.keys(x.faixas).length);
  if (!itens.length) return { ok: true, alteracoes: 0, resumo: [] };
  const keys = itens.map((x) => x.key);
  const antes = new Map<string, number>();
  for (const r of await lerChaves("painel_precos", "key", keys)) antes.set(`${r.key}|${r.faixa}`, Number(r.valor));
  const info = new Map((await lerChaves("painel_cenarios", "key", keys)).map((c: any) => [c.key, c]));
  const linhas: any[] = [], hist: any[] = [], porTabela = new Map<string, any[]>();
  for (const x of itens) {
    for (const [faixa, v] of Object.entries(x.faixas)) {
      const valor = Number(v); if (!Number.isFinite(valor)) continue;
      linhas.push({ key: x.key, faixa, valor, atualizado_em: agora });
      const a = antes.get(`${x.key}|${faixa}`);
      if (a === undefined || Math.abs(a - valor) >= 0.01) hist.push({ key: x.key, faixa, valor, data: hoje });
      if (a !== undefined && Math.abs(a - valor) >= 0.01) {
        const c = info.get(x.key) || {};
        const g = `${c.operadora}|${c.tabela_id}|${c.modalidade}`;
        if (!porTabela.has(g)) porTabela.set(g, []);
        porTabela.get(g)!.push({ c, faixa, a, valor });
      }
    }
  }
  for (let i = 0; i < linhas.length; i += 500) await db.from("painel_precos").upsert(linhas.slice(i, i + 500), { onConflict: "key,faixa" });
  for (let i = 0; i < hist.length; i += 500) await db.from("painel_precos_historico").upsert(hist.slice(i, i + 500), { onConflict: "key,faixa,data" });
  const mudancas = [...porTabela.values()].map((lst) => {
    const c = lst[0].c, media = lst.reduce((s, x) => s + pct(x.a, x.valor), 0) / lst.length, ex = lst[0];
    const item = (x: any) => ({ chave: `${x.c.key}|${x.faixa}`, plano: x.c.plano, faixa: x.faixa, acomodacao: ACOM[x.c.acomodacao] ?? "", coparticipacao: x.c.coparticipacao ? (x.c.copart_tipo || "Com coparticipação").trim() : "Sem coparticipação" });
    return { tipo: "painel_preco", operadora: c.operadora, uf: b.uf || null, chave: `painel|${c.tabela_id}|${c.modalidade}`, notificado: true, detectado_em: agora,
      descricao: `Painel do Corretor – ${c.operadora} · ${c.tabela} (${MOD[c.modalidade] || ""}${c.administradora && c.administradora !== c.operadora ? " · " + c.administradora : ""}): ${lst.length} preço(s) mudaram, média ${media >= 0 ? "+" : ""}${media.toFixed(1).replace(".", ",")}% — ex.: ${ex.c.plano} ${ex.faixa}: R$ ${brl(ex.a)} → R$ ${brl(ex.valor)}`,
      antes: lst.map((x) => ({ ...item(x), valor: x.a })), depois: lst.map((x) => ({ ...item(x), valor: x.valor, pct: pct(x.a, x.valor) })) };
  });
  if (mudancas.length) await db.from("mudancas").insert(mudancas);
  return { ok: true, gravados: linhas.length, alteracoes: mudancas.length, resumo: mudancas.map((m) => m.descricao) };
}

async function status(b: any) {
  const valor = JSON.stringify({ uf: "Painel", conta: b.conta || "", quando: new Date().toISOString(), resultado: String(b.resultado || "").slice(0, 500), tabelas: b.tabelas ?? null, versao: b.versao || "" });
  await db.from("config").upsert({ chave: "extensao_status_painel", valor }, { onConflict: "chave" });
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, motivo: "use POST" }, 405);
  try {
    const b = await req.json();
    if (!(await chaveValida(b?.k))) return json({ ok: false, motivo: "chave inválida" }, 403);
    if (b.tipo === "painel_cenarios") return json(await painelCenarios(b));
    if (b.tipo === "painel_precos") return json(await painelPrecos(b));
    if (b.tipo === "status") return json(await status(b));
    return json({ ok: false, motivo: "tipo desconhecido" }, 400);
  } catch (e) {
    return json({ ok: false, motivo: String(e) }, 500);
  }
});
