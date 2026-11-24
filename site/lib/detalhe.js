import 'server-only';
import { db, tudo } from './db';
import { rotuloFaixa, brl, dataBR } from './util';

// Detalhe completo de cada alteração, num formato único de tabela: { aviso?, linhas: [[...]], colunas: [...] }.
// Serve para a página (quadro "ver detalhes") e para a planilha (uma aba por tipo).

const FAIXAS = ['00-18', '19-23', '24-28', '29-33', '34-38', '39-43', '44-48', '49-53', '54-58', '59+'];
const pctTxt = (v) => (v == null || v === '' ? 'sem desconto' : `${String(Number(v)).replace('.', ',')}%`);
const variacao = (a, n) => (a ? `${((n - a) / a * 100 >= 0 ? '+' : '')}${((n - a) / a * 100).toFixed(2).replace('.', ',')}%` : '');

// Combinação a partir da chave de preço (formato antigo): tabela|plano|uf|faixa|acomodação|copart|taxa
function deChave(chave, planos) {
  const [, plano, , faixa, acomodacao, coparticipacao] = String(chave || '').split('|');
  return { plano: planos.get(Number(plano)) || plano, faixa, acomodacao, coparticipacao };
}

// Carrega o que o detalhe precisa para um conjunto de alterações (nomes de tabela/plano e grades de preço).
export async function contextoDetalhe(mudancas) {
  const s = db();
  const tabIds = [...new Set(mudancas.map((m) => m.tabela_id).filter(Boolean))];
  const tabelas = new Map();
  for (let i = 0; i < tabIds.length; i += 200) {
    const { data } = await s.from('tabelas').select('id,nome,administradora,tipo_tabela,planos').in('id', tabIds.slice(i, i + 200));
    for (const t of data || []) tabelas.set(t.id, t);
  }
  const planos = new Map();
  for (const t of tabelas.values()) for (const p of t.planos || []) planos.set(p.id, p.nome);
  // Grades de preço atuais para tabela nova e para alterações antigas sem detalhe guardado
  const precisaGrade = mudancas.filter((m) => m.tabela_id && (m.tipo === 'tabela_nova' || (m.tipo === 'desconto' && !Array.isArray(m.depois))));
  const grades = new Map();
  for (const m of precisaGrade) {
    const k = `${m.tabela_id}|${m.tipo === 'tabela_nova' ? '' : m.uf || ''}`;
    if (grades.has(k)) continue;
    const linhas = await tudo(() => {
      let q = s.from('precos').select('plano,uf,acomodacao,coparticipacao,faixa,valor,valor_bruto,desconto').eq('tabela_id', m.tabela_id);
      if (m.tipo !== 'tabela_nova' && m.uf) q = q.eq('uf', m.uf);
      return q.order('uf').order('plano').order('acomodacao').order('coparticipacao').order('faixa');
    });
    grades.set(k, linhas);
  }
  return { tabelas, planos, grades };
}

function grade(linhas, comDesconto) {
  const porComb = new Map();
  for (const l of linhas) {
    const k = `${l.uf}|${l.plano}|${l.acomodacao}|${l.coparticipacao}`;
    if (!porComb.has(k)) porComb.set(k, { l, f: {} });
    porComb.get(k).f[l.faixa] = comDesconto ? l : Number(l.valor_bruto ?? l.valor);
  }
  return [...porComb.values()].map(({ l, f }) => (comDesconto
    ? [l.uf, l.plano, l.acomodacao, l.coparticipacao, pctTxt(Object.values(f)[0]?.desconto), ...FAIXAS.map((x) => (f[x] ? Number(f[x].valor_bruto ?? f[x].valor) : null))]
    : [l.uf, l.plano, l.acomodacao, l.coparticipacao, ...FAIXAS.map((x) => f[x] ?? null)]));
}

export function detalhe(m, ctx) {
  const antes = m.antes, depois = m.depois;
  switch (m.tipo) {
    case 'preco': {
      const a = new Map((Array.isArray(antes) ? antes : []).map((x) => [x.chave, x]));
      return {
        colunas: ['Plano', 'Acomodação', 'Coparticipação', 'Faixa', 'Antes', 'Depois', 'Variação'], moeda: [4, 5],
        linhas: (Array.isArray(depois) ? depois : []).map((d) => {
          const c = d.plano ? d : deChave(d.chave, ctx.planos);
          const va = Number(a.get(d.chave)?.valor), vn = Number(d.valor);
          return [c.plano, c.acomodacao, c.coparticipacao, rotuloFaixa(c.faixa || ''), va, vn, variacao(va, vn)];
        }),
      };
    }
    case 'desconto': {
      if (!Array.isArray(depois)) {
        const g = ctx.grades.get(`${m.tabela_id}|${m.uf || ''}`) || [];
        return {
          aviso: 'Alteração anterior à gravação do detalhe: abaixo, como a tabela está hoje (desconto atual e valores cheios).',
          colunas: ['UF', 'Plano', 'Acomodação', 'Coparticipação', 'Desconto hoje', ...FAIXAS.map(rotuloFaixa)], moeda: FAIXAS.map((_, i) => 5 + i),
          linhas: grade(g, true),
        };
      }
      const a = new Map((antes || []).map((x) => [x.chave, x]));
      return {
        colunas: ['Plano', 'Acomodação', 'Coparticipação', 'Faixa', 'Desconto antes', 'Desconto agora', 'Valor cheio', 'Com desconto antes', 'Com desconto agora'], moeda: [6, 7, 8],
        linhas: depois.map((d) => { const x = a.get(d.chave) || {}; return [d.plano, d.acomodacao, d.coparticipacao, rotuloFaixa(d.faixa || ''), pctTxt(x.desconto), pctTxt(d.desconto), d.valor_cheio, x.valor, d.valor]; }),
      };
    }
    case 'novo_preco_agendado':
    case 'encerrada':
    case 'combinacao_removida': {
      const itens = Array.isArray(depois) ? depois : Array.isArray(antes) ? antes : [];
      if (!itens.length) return { aviso: 'Alteração anterior à gravação do detalhe.', colunas: [], linhas: [] };
      const col = m.tipo === 'novo_preco_agendado' ? 'Preço novo em' : m.tipo === 'encerrada' ? 'Encerrada em' : null;
      return {
        colunas: ['Plano', 'Acomodação', 'Coparticipação', 'Faixa', 'Valor', ...(col ? [col] : [])], moeda: [4],
        linhas: itens.map((d) => [d.plano, d.acomodacao, d.coparticipacao, rotuloFaixa(d.faixa || ''), d.valor,
          ...(col ? [dataBR(d.novo_preco_em || d.encerrada_em)] : [])]),
      };
    }
    case 'coparticipacao':
    case 'carencia': {
      const nome = (x) => x.item || (x.text_carencia || '').replace(/\s+/g, ' ').trim();
      const valor = (x) => (m.tipo === 'carencia' ? x.tempo : [x.percent_text, x.text_valor_copart].filter(Boolean).join(' · ') || '—');
      const ia = new Map((antes?.itens || []).map((x) => [nome(x), valor(x)]));
      const id = new Map((depois?.itens || []).map((x) => [nome(x), valor(x)]));
      const itens = [...new Set([...ia.keys(), ...id.keys()])];
      const vig = (x) => (x?.vigencia_inicio ? `${dataBR(x.vigencia_inicio)} a ${dataBR(x.vigencia_fim)}` : '—');
      const cab = [
        ['(tabela)', antes?.nome || '(sem tabela vigente)', depois?.nome || '(sem tabela vigente)', ''],
        ['(vigência)', vig(antes), vig(depois), ''],
      ];
      if (depois?.planos_afetados?.length) cab.push(['(planos afetados)', '', depois.planos_afetados.join(', '), '']);
      if (depois?.copart_opcoes?.length) cab.push(['(opções de coparticipação)', '', depois.copart_opcoes.join(', '), '']);
      return {
        colunas: [m.tipo === 'carencia' ? 'Cobertura' : 'Item', 'Antes', 'Depois', 'Mudou?'],
        linhas: [...cab, ...itens.map((k) => [k, ia.get(k) ?? '—', id.get(k) ?? '—', (ia.get(k) ?? '') !== (id.get(k) ?? '') ? 'Sim' : ''])],
      };
    }
    case 'desconto_vidas': {
      const a = new Map((antes || []).map((x) => [x.chave, x.texto]));
      return {
        colunas: ['Plano', 'Acomodação', 'Coparticipação', 'Regra antes', 'Regra agora'],
        linhas: (depois || []).map((d) => [d.plano || deChave(d.chave, ctx.planos).plano, d.acomodacao || '', d.coparticipacao || '', a.get(d.chave) || '—', d.texto]),
      };
    }
    case 'area_entrou':
    case 'area_saiu': {
      const cs = (m.tipo === 'area_entrou' ? depois : antes) || [];
      return { colunas: ['Cidade', 'UF'], linhas: cs.map((c) => { const [n, uf] = String(c).split('/'); return [n, uf || '']; }) };
    }
    case 'planos': {
      let entrou, saiu;
      if (depois && !Array.isArray(depois)) { entrou = depois.entrou || []; saiu = antes?.saiu || []; }
      else {
        const a = new Map((antes || []).map((p) => [p.id, p.nome])), d = new Map((depois || []).map((p) => [p.id, p.nome]));
        entrou = (depois || []).filter((p) => !a.has(p.id)); saiu = (antes || []).filter((p) => !d.has(p.id));
      }
      return { colunas: ['Situação', 'Plano', 'Código'], linhas: [...entrou.map((p) => ['Entrou', p.nome, p.id]), ...saiu.map((p) => ['Saiu', p.nome, p.id])] };
    }
    case 'tabela_nova': {
      const g = ctx.grades.get(`${m.tabela_id}|`) || [];
      const t = depois || {};
      return {
        aviso: `${t.tipo_tabela || ''} · ${t.administradora || ''} · mínimo de vidas: ${t.minimo_vidas ?? '—'} · planos: ${(t.planos || []).map((p) => p.nome).join(', ')}`,
        colunas: ['UF', 'Plano', 'Acomodação', 'Coparticipação', ...FAIXAS.map(rotuloFaixa)], moeda: FAIXAS.map((_, i) => 4 + i),
        linhas: g.length ? grade(g, false) : [['(preços entram na próxima conferência diária)']],
      };
    }
    case 'rede': {
      const pp = depois?.porPlano;
      if (pp?.length) {
        return {
          colunas: ['Plano', 'Situação', 'Local', 'Tipo', 'Cobertura'],
          linhas: pp.flatMap((x) => [...x.entrou.map((l) => [x.plano, 'Entrou', l.nome, l.tipo, l.cobertura || '']), ...x.saiu.map((l) => [x.plano, 'Saiu', l.nome, l.tipo, l.cobertura || ''])]),
        };
      }
      return { colunas: ['Situação', 'Local'], linhas: [...(depois?.entrou || []).map((n) => ['Entrou', n]), ...(antes?.saiu || []).map((n) => ['Saiu', n])] };
    }
    case 'extensao': {
      const fmt = (campo, v) => (typeof v === 'number' && /anos/.test(campo) ? brl(v) : v === '' || v == null ? '—' : String(v));
      return {
        colunas: ['Seção', 'Mudança', 'Plano / item', 'Campo', 'Antes', 'Depois'],
        linhas: (Array.isArray(depois) ? depois : []).map((d) => [d.secao, d.mudanca, d.item, d.campo, fmt(d.campo, d.de), fmt(d.campo, d.para)]),
      };
    }
    default:
      return { colunas: [], linhas: [] };
  }
}

export const formatarCelula = (v, moeda) => (v == null || v === '' ? '—' : moeda && typeof v === 'number' ? brl(v) : String(v));
