// Recebe os dados da extensão do Chrome (Monitor Cotador v3) e grava no banco do site.
// POST JSON com { k: <extensao_key>, tipo, ... }
//   tipo "precos":      preços de UMA tabela num estado (todas as combinações) → compara, grava e registra alterações
//   tipo "alteracoes":  alterações de coparticipação/desconto/tabela que a extensão detectou → página de alterações
//   tipo "status":      resumo da última verificação de cada conta/estado (aparece no painel)
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

type Linha = {
  chave: string; tabela_id: number; plano_id: number; uf_id: number; uf: string; tipo_tabela: string; faixa: string;
  acomodacao: string; coparticipacao: string; plano: string; operadora_id: number | null; administradora: string;
  valor: number; valor_bruto: number; desconto: number | null; encerrada: boolean; encerrada_em: string | null;
  novo_preco_em: string | null; taxa_adesao: number | null; atualizado_em?: string;
};

async function receberPrecos(b: any) {
  const t = b.tabela, ufId = Number(b.uf_id), uf = String(b.uf), conta = String(b.conta || "");
  const linhas: Linha[] = (b.precos || []).filter((l: Linha) => l && l.tabela_id === t.id && Number.isFinite(Number(l.valor_bruto)));
  if (!t?.id || !ufId || !linhas.length) return { ok: false, motivo: "sem dados" };
  const agora = new Date().toISOString();

  // tabela e estado (cria se for nova)
  const { data: tab } = await db.from("tabelas").select("id,nome,operadora,planos").eq("id", t.id).maybeSingle();
  if (!tab) {
    await db.from("tabelas").insert({ id: t.id, nome: t.nome, operadora: t.operadora, operadora_id: t.operadora_id ?? null,
      administradora: t.administradora || "direto", tipo_tabela: t.tipo_tabela, uf_id: ufId, minimo_vidas: t.minimo_vidas ?? null,
      planos: t.planos || [], ativa: true, primeira_vez: agora, ultima_vez: agora });
  } else {
    const planos = new Map((tab.planos || []).map((p: any) => [p.id, p]));
    for (const p of t.planos || []) if (!planos.has(p.id)) planos.set(p.id, p);
    await db.from("tabelas").update({ ultima_vez: agora, ativa: true, planos: [...planos.values()] }).eq("id", t.id);
  }
  // cidades onde a tabela aparece (por nome: os ids do site do cotador podem não bater com os do banco)
  const nomes = [...new Set((b.cidades || []).map((x: unknown) => String(x)))].slice(0, 2000);
  if (nomes.length) {
    const ids: number[] = [];
    for (let i = 0; i < nomes.length; i += 300) {
      const { data } = await db.from("cidades").select("id").eq("uf", uf).in("nome", nomes.slice(i, i + 300));
      for (const c of data || []) ids.push(c.id);
    }
    for (let i = 0; i < ids.length; i += 500)
      await db.from("tabela_cidade").upsert(ids.slice(i, i + 500).map((cidade_id) => ({ tabela_id: t.id, cidade_id, ultima_vez: agora })), { onConflict: "tabela_id,cidade_id" });
  }

  // primeira vez que a extensão manda esta tabela/estado: só grava a base, sem alertas
  // (evita alertas falsos por diferença de formato com a coleta antiga)
  const { data: visto } = await db.from("extensao_vistos").select("tabela_id").eq("tabela_id", t.id).eq("uf_id", ufId).maybeSingle();
  const { data: antigasRaw } = await db.from("precos").select("*").eq("tabela_id", t.id).eq("uf_id", ufId).limit(5000);
  const antigas = new Map((antigasRaw || []).map((a: Linha) => [a.chave, a]));
  const novas = new Map(linhas.map((l) => [l.chave, { ...l, uf, atualizado_em: agora }]));
  const mudancas: any[] = [];

  if (visto) {
    const nome = `${t.nome} (${uf})`;
    const base = { operadora: t.operadora, tabela_id: t.id, uf, notificado: true, detectado_em: agora };
    const item = (x: Linha) => ({ chave: x.chave, plano: x.plano, plano_id: x.plano_id, faixa: x.faixa, acomodacao: x.acomodacao, coparticipacao: x.coparticipacao });
    const alteradas: any[] = [], descontos: any[] = [], agendadas: Linha[] = [], encerradas: Linha[] = [];
    for (const n of novas.values()) {
      const a = antigas.get(n.chave);
      if (!a) continue;
      const cA = Number(a.valor_bruto ?? a.valor), cN = Number(n.valor_bruto ?? n.valor);
      if (Math.abs(cA - cN) >= 0.01) alteradas.push({ a, n, p: pct(cA, cN), cA, cN });
      if (String(a.desconto ?? "") !== String(n.desconto ?? "")) descontos.push({ a, n });
      if (n.novo_preco_em && String(n.novo_preco_em).slice(0, 10) !== String(a.novo_preco_em ?? "").slice(0, 10)) agendadas.push(n);
      if (n.encerrada && !a.encerrada) encerradas.push(n);
    }
    const k = `${t.id}|${ufId}`;
    if (alteradas.length) {
      const media = alteradas.reduce((s, x) => s + x.p, 0) / alteradas.length, ex = alteradas[0];
      mudancas.push({ ...base, tipo: "preco", chave: k,
        descricao: `${nome}: ${alteradas.length} preço(s) de tabela mudaram, média ${media >= 0 ? "+" : ""}${media.toFixed(1).replace(".", ",")}% — ex.: ${ex.n.plano} ${ex.n.acomodacao} ${ex.n.faixa}: R$ ${brl(ex.cA)} → R$ ${brl(ex.cN)}`,
        antes: alteradas.map((x) => ({ ...item(x.n), valor: x.cA })), depois: alteradas.map((x) => ({ ...item(x.n), valor: x.cN, pct: x.p })) });
    }
    if (descontos.length) {
      const ex = descontos[0];
      mudancas.push({ ...base, tipo: "desconto", chave: k,
        descricao: `${nome}: desconto/campanha mudou em ${descontos.length} combinação(ões) — ex.: ${ex.n.plano} ${ex.n.acomodacao} ${ex.n.faixa}: ${ex.a.desconto != null ? ex.a.desconto + "%" : "sem desconto"} → ${ex.n.desconto != null ? ex.n.desconto + "%" : "sem desconto"}`,
        antes: descontos.map(({ a, n }) => ({ ...item(n), desconto: a.desconto ?? null, valor: Number(a.valor), valor_cheio: Number(a.valor_bruto ?? a.valor) })),
        depois: descontos.map(({ n }) => ({ ...item(n), desconto: n.desconto ?? null, valor: Number(n.valor), valor_cheio: Number(n.valor_bruto ?? n.valor) })) });
    }
    if (agendadas.length) {
      const datas = [...new Set(agendadas.map((x) => String(x.novo_preco_em).slice(0, 10)))].map((d) => d.split("-").reverse().join("/"));
      mudancas.push({ ...base, tipo: "novo_preco_agendado", chave: k, descricao: `${nome}: preço novo agendado para ${datas.join(", ")} (${agendadas.length} combinações)`,
        depois: agendadas.map((x) => ({ ...item(x), novo_preco_em: x.novo_preco_em, valor: Number(x.valor_bruto) })) });
    }
    if (encerradas.length) {
      mudancas.push({ ...base, tipo: "encerrada", chave: k, descricao: `${nome}: ${encerradas.length} combinação(ões) marcadas como encerradas`,
        depois: encerradas.map((x) => ({ ...item(x), encerrada_em: x.encerrada_em, valor: Number(x.valor_bruto) })) });
    }
    const sumiram = [...antigas.values()].filter((a) => !novas.has(a.chave));
    if (sumiram.length) {
      mudancas.push({ ...base, tipo: "combinacao_removida", chave: k,
        descricao: `${nome}: ${sumiram.length} combinação(ões) de preço saíram (${[...new Set(sumiram.map((x) => `${x.plano} ${x.acomodacao} ${x.coparticipacao}`))].slice(0, 4).join("; ")})`,
        antes: sumiram.map((x) => ({ ...item(x), valor: Number(x.valor_bruto ?? x.valor) })) });
    }
  }

  // grava preços atuais, histórico e tira o que saiu
  const lista = [...novas.values()];
  for (let i = 0; i < lista.length; i += 500) {
    const { error } = await db.from("precos").upsert(lista.slice(i, i + 500), { onConflict: "chave" });
    if (error) return { ok: false, motivo: error.message };
  }
  const hoje = agora.slice(0, 10);
  const hist = lista.filter((n) => { const a = antigas.get(n.chave); return !a || Math.abs(Number(a.valor_bruto ?? a.valor) - Number(n.valor_bruto)) >= 0.01; })
    .map((n) => ({ chave: n.chave, tabela_id: n.tabela_id, plano_id: n.plano_id, uf_id: n.uf_id, faixa: n.faixa, acomodacao: n.acomodacao, coparticipacao: n.coparticipacao, valor: n.valor_bruto, data: hoje }));
  for (let i = 0; i < hist.length; i += 500) await db.from("precos_historico").upsert(hist.slice(i, i + 500), { onConflict: "chave,data" });
  const sairam = [...antigas.keys()].filter((c) => !novas.has(c));
  for (let i = 0; i < sairam.length; i += 200) await db.from("precos").delete().in("chave", sairam.slice(i, i + 200));
  if (mudancas.length) await db.from("mudancas").insert(mudancas);
  await db.from("extensao_vistos").upsert({ tabela_id: t.id, uf_id: ufId, ultima_vez: agora, conta, ...(visto ? {} : { primeira_vez: agora }) }, { onConflict: "tabela_id,uf_id" });
  return { ok: true, base: !visto, combinacoes: lista.length, alteracoes: mudancas.length };
}

async function receberAlteracoes(b: any) {
  const agora = new Date().toISOString();
  const grupos = new Map<string, any[]>();
  for (const c of b.itens || []) {
    if (!c?.m) continue;
    const k = c.m.slice(0, 5).join("|");
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(c);
  }
  const SEC: Record<string, string> = { tabelas: "Tabela", coparts: "Coparticipação", descontos: "Desconto" };
  const linhas = [...grupos.values()].map((lst) => {
    const [op, adm, uf, tipo, tab] = lst[0].m;
    const secs = [...new Set(lst.map((c: any) => SEC[c.sec] || c.sec))];
    return {
      tipo: "extensao", operadora: op, uf, tabela_id: Number(lst[0].tid) || null, chave: `${tab}|${uf}|${tipo}`, notificado: true, detectado_em: agora,
      descricao: `${tab} (${uf} ${tipo}${adm && adm !== "(direto)" ? ` · ${adm}` : ""}): ${lst.length} alteração(ões) de ${secs.join(", ").toLowerCase()}`,
      depois: lst.map((c: any) => ({ secao: SEC[c.sec] || c.sec, mudanca: c.tipo, item: c.m[5] || "", campo: c.campo || "", de: c.de ?? "", para: c.para ?? "" })),
    };
  });
  if (linhas.length) await db.from("mudancas").insert(linhas);
  return { ok: true, registradas: linhas.length };
}

async function receberStatus(b: any) {
  const uf = String(b.uf || "").toUpperCase().slice(0, 2);
  if (!uf) return { ok: false };
  const valor = JSON.stringify({ uf, conta: b.conta || "", quando: new Date().toISOString(), resultado: String(b.resultado || "").slice(0, 500),
    tabelas: b.tabelas ?? null, versao: b.versao || "" });
  await db.from("config").upsert({ chave: `extensao_status_${uf}`, valor }, { onConflict: "chave" });
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, motivo: "use POST" }, 405);
  try {
    const b = await req.json();
    if (!(await chaveValida(b?.k))) return json({ ok: false, motivo: "chave inválida" }, 403);
    if (b.tipo === "precos") return json(await receberPrecos(b));
    if (b.tipo === "alteracoes") return json(await receberAlteracoes(b));
    if (b.tipo === "status") return json(await receberStatus(b));
    return json({ ok: false, motivo: "tipo desconhecido" }, 400);
  } catch (e) {
    return json({ ok: false, motivo: String(e) }, 500);
  }
});
