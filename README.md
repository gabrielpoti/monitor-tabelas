# Monitor de Tabelas

Confere todos os dias, pelo **conector oficial (MCP) do Cotador Simplificado**, as tabelas de:
Hapvida, Hapvida Clinipam, NotreDame, Amil (incl. Black/One), Bradesco Saúde, SulAmérica e todas as Unimeds.

## O que roda e quando

| Modo | Quando | O que faz |
|---|---|---|
| `diario` | todo dia 03:17 | preço por faixa etária (10 faixas ANS) de cada plano/acomodação/coparticipação, desconto, "preço novo agendado", tabelas encerradas, coparticipação vigente e carência + regras de aceitação |
| `semanal` | domingo e quarta à noite | liga os 5.570 municípios do IBGE ao cotador e varre a **área de comercialização** (quais tabelas aparecem em cada cidade). Retoma de onde parou se não terminar |
| `teste` | manual | só confere o login e lista as ferramentas |

Mudanças vão para a tabela `mudancas` do Supabase e para o Telegram.
A primeira carga de cada parte só monta a base (não dispara alertas).

## Peças

- **Supabase `monitor-tabelas`**: banco (`tabelas`, `tabela_cidade`, `precos`, `coparticipacao`, `carencia`, `mudancas`, `execucoes`) e a função `cotador-auth`, que faz o login OAuth no cotador e guarda o acesso.
- **GitHub Actions** (`.github/workflows/monitor.yml`): roda o `src/index.js`.

## Secrets do repositório (Settings → Secrets and variables → Actions)

- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → projeto monitor-tabelas → Project Settings → API Keys → `service_role` (secret)
- `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` — os mesmos do monitor atual

## Se o login cair

Abra de novo o link de login da função `cotador-auth` (com a chave `k=` guardada na tabela `config`, linha `login_key`) e autorize.

## Ajustes

- Operadoras: `src/config.js` (`OPERADORAS_IDS` e `OPERADORAS_NOMES`).
- Ritmo: variáveis `CONCORRENCIA` (padrão 3) e `PAUSA_MS` (padrão 150).
