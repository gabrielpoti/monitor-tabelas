// Login OAuth do monitor no MCP do Cotador Simplificado.
// GET /cotador-auth?k=<login_key>[&c=2|3]  → cadastra o cliente (se preciso) e manda para a tela de autorização
//   c ausente = conta principal ('cotador'); c=2 → 'cotador2'; c=3 → 'cotador3' (contas extras dividem as consultas)
// GET /cotador-auth/retorno         → troca o código pelo token e guarda em oauth_state
import { createClient } from "npm:@supabase/supabase-js@2";

const AS = "https://mcp.cotadorsimplificado.com.br";
const RESOURCE = AS + "/mcp";
const SELF = Deno.env.get("SUPABASE_URL")! + "/functions/v1/cotador-auth";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// O Supabase não deixa funções servirem HTML no domínio padrão; respondemos em texto simples.
const page = (titulo: string, msg: string, status = 200) =>
  new Response(`${titulo}\n\n${msg}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const redirectUri = SELF + "/retorno";
  try {
    if (url.pathname.endsWith("/retorno")) {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (url.searchParams.get("error")) return page("Login cancelado", "O cotador não autorizou: " + url.searchParams.get("error"), 400);
      if (!code || !state) return page("Link inválido", "Comece o login de novo pelo link do monitor.", 400);
      const { data: st } = await db.from("oauth_state").select("*").eq("state", state).maybeSingle();
      if (!st) return page("Link inválido", "Comece o login de novo pelo link do monitor.", 400);
      const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: st.client_id, code_verifier: st.pkce_verifier, resource: RESOURCE });
      const r = await fetch(AS + "/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
      const tok = await r.json();
      if (!r.ok || !tok.refresh_token) return page("Falhou", "O cotador recusou a troca do código (" + r.status + "). Tente de novo.", 500);
      await db.from("oauth_state").update({
        access_token: tok.access_token, refresh_token: tok.refresh_token,
        expires_at: new Date(Date.now() + (tok.expires_in ?? 3600) * 1000).toISOString(),
        state: null, pkce_verifier: null, conta_nome: null, updated_at: new Date().toISOString(),
      }).eq("id", st.id);
      const qual = st.id === "cotador" ? "principal" : "extra " + st.id.replace("cotador", "");
      return page("Pronto ✅", `Conta ${qual} conectada ao monitor. Pode fechar esta página.`);
    }

    const { data: cfg } = await db.from("config").select("valor").eq("chave", "login_key").single();
    if (!cfg || url.searchParams.get("k") !== cfg.valor) return page("Acesso negado", "Link de login inválido.", 403);
    const c = url.searchParams.get("c");
    if (c && !/^[23]$/.test(c)) return page("Link inválido", "Conta inválida.", 400);
    const ID = c ? "cotador" + c : "cotador";

    let { data: st } = await db.from("oauth_state").select("*").eq("id", ID).maybeSingle();
    if (!st?.client_id || st.redirect_uri !== redirectUri) {
      const r = await fetch(AS + "/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        client_name: "Monitor de Tabelas", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"], token_endpoint_auth_method: "none", scope: "mcp:read" }) });
      const reg = await r.json();
      if (!r.ok || !reg.client_id) return page("Falhou", "O cotador recusou o cadastro do monitor (" + r.status + ").", 500);
      await db.from("oauth_state").upsert({ id: ID, client_id: reg.client_id, client_secret: reg.client_secret ?? null, redirect_uri: redirectUri });
      st = { client_id: reg.client_id } as any;
    }
    const verifier = rand(48);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const state = rand(16);
    await db.from("oauth_state").update({ pkce_verifier: verifier, state }).eq("id", ID);
    const auth = new URL(AS + "/authorize");
    for (const [k, v] of Object.entries({ response_type: "code", client_id: st!.client_id, redirect_uri: redirectUri, scope: "mcp:read", state, code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE })) auth.searchParams.set(k, v);
    return Response.redirect(auth.toString(), 302);
  } catch (e) {
    return page("Erro", String(e), 500);
  }
});
