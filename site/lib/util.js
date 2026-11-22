export const GRUPOS = ['Hapvida', 'Hapvida Clinipam', 'NotreDame', 'Amil', 'Bradesco Saúde', 'SulAmérica', 'Unimed', 'Alice'];

export const slug = (g) => g.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
export const grupoDoSlug = (s) => GRUPOS.find((g) => slug(g) === s) || null;

export const FAIXAS = ['00-18', '19-23', '24-28', '29-33', '34-38', '39-43', '44-48', '49-53', '54-58', '59+'];
export const COLS_FAIXA = ['f00_18', 'f19_23', 'f24_28', 'f29_33', 'f34_38', 'f39_43', 'f44_48', 'f49_53', 'f54_58', 'f59'];
export const rotuloFaixa = (f) => (f === '59+' ? '59 ou +' : f.replace('-', ' a '));

export const brl = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
export const dataBR = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');
export const dataHoraBR = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—');

export const TIPOS_MUDANCA = {
  preco: 'Preço', novo_preco_agendado: 'Preço novo agendado', desconto: 'Desconto', encerrada: 'Encerrada',
  combinacao_removida: 'Combinação removida', coparticipacao: 'Coparticipação', carencia: 'Carência',
  tabela_nova: 'Tabela nova', tabela_removida: 'Tabela removida', tabela_voltou: 'Tabela voltou', planos: 'Planos',
  area_entrou: 'Área (entrou)', area_saiu: 'Área (saiu)', rede: 'Rede credenciada', desconto_vidas: 'Desconto por quantidade',
};

const TIPOS_LOCAL = {
  hosp: 'Hospital', ps: 'Pronto-socorro', lab: 'Laboratório', cli: 'Clínica', img: 'Imagem / diagnóstico',
  cons: 'Consultório', odonto: 'Odontologia', mat: 'Maternidade', terapia: 'Terapias', outros: 'Outros',
};
export const tipoLocal = (t) => TIPOS_LOCAL[t] || t || '—';
export const listaTiposLocal = () => Object.entries(TIPOS_LOCAL);

export function grupoDe(op) {
  const o = (op || '').toLowerCase();
  if (o.includes('clinipam')) return 'Hapvida Clinipam';
  if (o.includes('notre') || o.includes('gndi') || /interm.dica/.test(o)) return 'NotreDame';
  if (o.includes('hapvida')) return 'Hapvida';
  if (/\bamil\b/.test(o)) return 'Amil';
  if (o.includes('bradesco')) return 'Bradesco Saúde';
  if (/sul.?am.rica/.test(o)) return 'SulAmérica';
  if (o.includes('unimed')) return 'Unimed';
  if (/\balice\b/.test(o)) return 'Alice';
  return op || 'Outras';
}

// Padrões de busca por operadora no banco (ilike), espelhando grupo_operadora() do SQL.
export const FILTRO_GRUPO = {
  Hapvida: ['%hapvida%'], 'Hapvida Clinipam': ['%clinipam%'], NotreDame: ['%notre%', '%gndi%', '%interm%dica%'],
  Amil: ['amil%'], 'Bradesco Saúde': ['%bradesco%'], SulAmérica: ['%sul%am%rica%'], Unimed: ['%unimed%'], Alice: ['alice%'],
};
export const orIlike = (grupo, col = 'operadora') => FILTRO_GRUPO[grupo].map((p) => `${col}.ilike.${p}`).join(',');
