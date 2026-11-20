// Configuração central do monitor.

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://knvtovsrbyhpcgirgtbl.supabase.co';
export const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const TELEGRAM_CHAT = process.env.TELEGRAM_CHAT_ID;
export const SITE_URL = process.env.SITE_URL || 'https://monitor-tabelas.vercel.app';

export const MCP_BASE = 'https://mcp.cotadorsimplificado.com.br';
export const MCP_URL = MCP_BASE + '/mcp';

// Quantas chamadas simultâneas ao cotador e pausa mínima entre elas (ms).
export const CONCORRENCIA = Number(process.env.CONCORRENCIA || 2);
export const PAUSA_MS = Number(process.env.PAUSA_MS || 250);

// Tempo máximo de uma execução antes de salvar o ponto e parar (min).
// O GitHub Actions corta em 360 min; paramos antes para gravar o progresso.
export const LIMITE_MINUTOS = Number(process.env.LIMITE_MINUTOS || 290);

export const TIPOS_TABELA = ['PME', 'PJ', 'PF'];

// Operadoras monitoradas: ids conferidos no cotador + nomes (cobre as várias Unimeds).
export const OPERADORAS_IDS = new Set([
  3,    // Hapvida
  388,  // Hapvida Clinipam
  121,  // NotreDame (GNDI)
  1,    // Amil
  9,    // Amil Black / Amil One
  549,  // Bradesco Saúde
  11,   // SulAmérica
]);
export const OPERADORAS_NOMES = /hapvida|clinipam|notre ?dame|gndi|interm[eé]dica|amil|bradesco|sul ?am[eé]rica|unimed/i;

export const monitorada = (t) => OPERADORAS_IDS.has(t.operadoraId) || OPERADORAS_NOMES.test(t.operadora || '');

// Faixas etárias da ANS e uma idade representativa de cada.
export const FAIXAS = [
  ['00-18', 10], ['19-23', 21], ['24-28', 26], ['29-33', 31], ['34-38', 36],
  ['39-43', 41], ['44-48', 46], ['49-53', 51], ['54-58', 56], ['59+', 65],
];
