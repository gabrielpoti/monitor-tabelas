import { notFound } from 'next/navigation';
import { db, tudo } from '@/lib/db';
import { FAIXAS, rotuloFaixa, brl, dataBR, dataHoraBR, grupoDe, slug, TIPOS_MUDANCA } from '@/lib/util';
import Grafico from '../../Grafico';
import Baixar from '../../Baixar';

export const dynamic = 'force-dynamic';

export default async function Tabela({ params, searchParams }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  const s = db();
  const { data: t } = await s.from('v_tabelas').select('*').eq('id', id).maybeSingle();
  if (!t) notFound();
  const ufs = (await tudo(() => s.from('tabela_uf').select('uf_id,uf,cidades,cidade_exemplo').eq('tabela_id', id))).sort((a, b) => b.cidades - a.cidades);
  const uf = ufs.find((u) => u.uf === sp.uf) || ufs[0];
  const grupo = grupoDe(t.operadora);

  const [precos, copart, carencia, cidadesUf, mudancas, descontos] = uf ? await Promise.all([
    tudo(() => s.from('precos').select('*').eq('tabela_id', id).eq('uf_id', uf.uf_id)),
    tudo(() => s.from('coparticipacao').select('*').eq('tabela_id', id).eq('uf_id', uf.uf_id)),
    tudo(() => s.from('carencia').select('*').eq('tabela_id', id).eq('uf_id', uf.uf_id)),
    tudo(() => s.from('tabela_cidade').select('cidade_id').eq('tabela_id', id)),
    s.from('mudancas').select('id,tipo,descricao,detectado_em,uf').eq('tabela_id', id).order('id', { ascending: false }).limit(20),
    tudo(() => s.from('descontos').select('plano_id,acomodacao,coparticipacao,texto,tem_desconto').eq('tabela_id', id).eq('uf_id', uf.uf_id)),
  ]) : [[], [], [], [], { data: [] }, []];
  const descDe = new Map(descontos.map((d) => [`${d.plano_id}|${d.acomodacao}|${d.coparticipacao}`, d]));

  const verDesconto = sp.vd === '1';
  const temCampanha = precos.some((p) => Number(p.desconto) > 0);
  // grade de preços: plano × acomodação × copart × taxa, colunas = faixas
  const linhas = new Map();
  for (const p of precos) {
    const k = `${p.plano_id}|${p.acomodacao}|${p.coparticipacao}|${p.taxa_adesao ?? ''}`;
    if (!linhas.has(k)) linhas.set(k, { k, plano_id: p.plano_id, plano: p.plano, acomodacao: p.acomodacao, coparticipacao: p.coparticipacao, taxa: p.taxa_adesao, novo: p.novo_preco_em, encerrada: p.encerrada, desconto: p.desconto, f: {} });
    const l = linhas.get(k); l.f[p.faixa] = verDesconto ? p.valor : (p.valor_bruto ?? p.valor);
    if (p.novo_preco_em) l.novo = p.novo_preco_em; if (p.encerrada) l.encerrada = true; if (p.desconto != null) l.desconto = p.desconto;
  }
  const grade = [...linhas.values()].sort((a, b) => `${a.plano}${a.acomodacao}${a.coparticipacao}`.localeCompare(`${b.plano}${b.acomodacao}${b.coparticipacao}`));
  const atualizado = precos.reduce((m, p) => (p.atualizado_em > m ? p.atualizado_em : m), '');

  // histórico da combinação escolhida
  const sel = grade.find((l) => l.k === sp.h) || grade[0];
  const faixaSel = FAIXAS.includes(sp.faixa) ? sp.faixa : '29-33';
  let hist = [];
  if (sel) {
    const { data } = await s.from('precos_historico').select('data,valor').eq('tabela_id', id).eq('uf_id', uf.uf_id)
      .eq('plano_id', sel.plano_id).eq('acomodacao', sel.acomodacao).eq('coparticipacao', sel.coparticipacao).eq('faixa', faixaSel).order('data');
    hist = data || [];
  }

  // rede: cidade escolhida dentro da UF
  const vinculadas = new Set(cidadesUf.map((c) => c.cidade_id));
  const cidadesNaUf = (await tudo(() => s.from('cidades').select('id,nome').eq('uf_id', uf?.uf_id ?? -1)))
    .filter((c) => vinculadas.has(c.id)).sort((a, b) => a.nome.localeCompare(b.nome));
  const cidadeRede = Number(sp.cidade) || uf?.cidade_exemplo;
  const rede = cidadeRede ? await tudo(() => s.from('rede').select('plano,total,truncado,locais,atualizado_em').eq('tabela_id', id).eq('cidade_id', cidadeRede)) : [];

  const nomePlano = new Map((t.planos || []).map((p) => [p.id, p.nome]));
  const copartUnicas = new Map();
  for (const c of copart) { const k = `${c.copart_tab_id}|${c.coparticipacao}`; if (!copartUnicas.has(k)) copartUnicas.set(k, { ...c, planos: [] }); copartUnicas.get(k).planos.push(nomePlano.get(c.plano_id)); }
  const carUnica = new Map();
  for (const c of carencia) if (!carUnica.has(c.carencia_id)) carUnica.set(c.carencia_id, c);
  const qs = (o) => `?${new URLSearchParams({ ...(uf ? { uf: uf.uf } : {}), ...o }).toString()}`;

  return (
    <>
      <p className="pequeno"><a href={`/operadoras/${slug(grupo)}`}>← {grupo}</a></p>
      <h1>{t.nome}</h1>
      <p className="sub">
        {t.operadora} · {t.administradora} · {t.tipo_tabela} · mín. {t.minimo_vidas ?? '—'} vida(s)
        {t.exige_entidade && ' · exige entidade'} · {t.cidades} cidade(s) {t.ativa ? <span className="chip ok">ativa</span> : <span className="chip erro">removida</span>}
      </p>

      {ufs.length > 1 && (
        <div className="linha" style={{ marginBottom: '.5rem' }}>
          <span className="rotulo">UF:</span>
          {ufs.map((u) => <a key={u.uf} href={`?uf=${u.uf}`} className={`chip ${u.uf === uf?.uf ? 'ok' : ''}`}>{u.uf} ({u.cidades})</a>)}
        </div>
      )}

      <h2>Preços por faixa etária {uf && `— ${uf.uf}`}</h2>
      {temCampanha && (
        <div className="aviso">Esta tabela está com desconto/campanha no cotador. Mostrando {verDesconto ? <b>valores com desconto</b> : <b>valores de tabela (cheios)</b>} — <a href={qs({ ...(sp.h ? { h: sp.h } : {}), vd: verDesconto ? '0' : '1' })}>ver {verDesconto ? 'valores cheios' : 'valores com desconto'}</a>.</div>
      )}
      <p className="pequeno">Valor mensal por beneficiário (cotação de 1 pessoa). Conferido em {dataHoraBR(atualizado) || '—'}. Toque em uma linha para ver o histórico. {descontos.length ? (descontos.some((d) => d.tem_desconto) ? '👪 = desconto por quantidade de pessoas.' : 'Sem desconto por quantidade de pessoas nesta UF.') : 'Desconto por quantidade ainda não conferido (às segundas).'}</p>
      {grade.length ? (
        <div className="rolagem"><table>
          <thead><tr><th>Plano</th><th>Acomodação</th><th>Coparticipação</th>{FAIXAS.map((f) => <th key={f} className="n">{rotuloFaixa(f)}</th>)}<th></th></tr></thead>
          <tbody>{grade.map((l) => (
            <tr key={l.k} style={sel?.k === l.k ? { outline: '2px solid var(--destaque)' } : undefined}>
              <td><a href={`${qs({ h: l.k, faixa: faixaSel })}#historico`}>{l.plano}</a>{l.taxa != null && <span className="pequeno"> · adesão {brl(l.taxa)}</span>}
                {descDe.get(`${l.plano_id}|${l.acomodacao}|${l.coparticipacao}`)?.tem_desconto && <div className="pequeno">👪 {descDe.get(`${l.plano_id}|${l.acomodacao}|${l.coparticipacao}`).texto}</div>}</td>
              <td>{l.acomodacao}</td><td>{l.coparticipacao}</td>
              {FAIXAS.map((f) => <td key={f} className="n">{l.f[f] != null ? brl(l.f[f]) : '—'}</td>)}
              <td>{l.novo && <span className="chip alerta">novo preço {dataBR(l.novo)}</span>}{l.encerrada && <span className="chip erro">encerrada</span>}{Number(l.desconto) > 0 && <span className="chip alerta">desconto {String(l.desconto).replace('.', ',')}%</span>}</td>
            </tr>))}
          </tbody></table></div>
      ) : <div className="vazio">Preços ainda não conferidos para esta tabela. Eles entram na próxima conferência diária.{t.exige_entidade && t.tipo_tabela === 'PF' && ' Tabelas PF por adesão podem não ter preço sem a entidade.'}</div>}

      {sel && (<>
        <h2 id="historico">Histórico — {sel.plano} · {sel.acomodacao} · {sel.coparticipacao}</h2>
        <div className="linha" style={{ marginBottom: '.5rem' }}>
          {FAIXAS.map((f) => <a key={f} href={`${qs({ h: sel.k, faixa: f })}#historico`} className={`chip ${f === faixaSel ? 'ok' : ''}`}>{rotuloFaixa(f)}</a>)}
        </div>
        <Grafico pontos={hist} />
      </>)}

      <h2>Coparticipação {uf && `— ${uf.uf}`}</h2>
      {copartUnicas.size ? [...copartUnicas.values()].map((c) => (
        <details key={`${c.copart_tab_id}${c.coparticipacao}`} className="cartao" style={{ marginBottom: '.5rem' }} open={copartUnicas.size <= 2}>
          <summary><b>{c.coparticipacao || 'Padrão'}</b> — {c.nome || 'sem tabela vigente'} {c.vigencia_fim && <span className="pequeno">(vigência {dataBR(c.vigencia_inicio)} a {dataBR(c.vigencia_fim)})</span>}</summary>
          <p className="pequeno">Planos: {[...new Set(c.planos)].join(', ')}</p>
          {c.descricao && <p className="pequeno">{c.descricao}</p>}
          <table><tbody>{(c.itens || []).map((it, i) => <tr key={i}><td>{it.item}</td><td className="n">{it.text_valor_copart ?? it.percent_text}</td></tr>)}</tbody></table>
        </details>
      )) : <div className="vazio">Ainda não conferida.</div>}

      <h2>Carência {uf && `— ${uf.uf}`}</h2>
      {carUnica.size ? [...carUnica.values()].map((c) => (
        <div key={c.carencia_id ?? 'x'} className="cartao" style={{ marginBottom: '.5rem' }}>
          <b>{c.nome || 'Sem tabela vigente'}</b> {c.vigencia_fim && <span className="pequeno">(vigência {dataBR(c.vigencia_inicio)} a {dataBR(c.vigencia_fim)})</span>}
          <table style={{ marginTop: '.5rem' }}><tbody>{(c.itens || []).slice().sort((a, b) => a.rank - b.rank).map((it, i) => <tr key={i}><td style={{ whiteSpace: 'nowrap' }}><b>{it.tempo}</b></td><td>{it.text_carencia}</td></tr>)}</tbody></table>
          {!!(c.regras_aceitacao || []).length && <><p><b>Regras de aceitação</b></p><pre className="pequeno" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(c.regras_aceitacao, null, 1)}</pre></>}
        </div>
      )) : <div className="vazio">Ainda não conferida.</div>}

      <h2>Rede credenciada</h2>
      {cidadesNaUf.length > 0 && (
        <form className="filtros" method="get">
          <input type="hidden" name="uf" value={uf.uf} />
          <label>Cidade<select name="cidade" defaultValue={String(cidadeRede || '')}>{cidadesNaUf.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></label>
          <button type="submit">Ver rede</button>
        </form>
      )}
      {rede.length ? rede.map((r) => (
        <details key={r.plano} className="cartao" style={{ marginBottom: '.5rem' }}>
          <summary><b>{r.plano}</b> — {r.total} local(is){r.truncado && ' (lista parcial)'} <span className="pequeno">· atualizado em {dataBR(r.atualizado_em)}</span></summary>
          <table><tbody>{(r.locais || []).map((l, i) => <tr key={i}><td>{l.nome}</td><td>{l.tipo}</td><td className="pequeno">{l.cobertura}</td></tr>)}</tbody></table>
        </details>
      )) : <div className="vazio">Rede ainda não coletada para esta cidade. A coleta roda em ciclos de 90 dias, depois da 1ª carga da área.</div>}

      <h2>Área de comercialização {uf && `— ${uf.uf}`}</h2>
      <details className="cartao"><summary>{cidadesNaUf.length} cidade(s) em {uf?.uf}{ufs.length > 1 && ` · ${t.cidades} no total`}</summary>
        <p>{cidadesNaUf.map((c) => c.nome).join(', ')}</p>
      </details>

      <h2>Alterações desta tabela</h2>
      {(mudancas.data || []).length ? (
        <div className="rolagem"><table><tbody>{mudancas.data.map((m) => (
          <tr key={m.id}><td className="pequeno">{dataHoraBR(m.detectado_em)}</td><td><span className="chip">{TIPOS_MUDANCA[m.tipo] || m.tipo}</span> {m.descricao}</td></tr>))}
        </tbody></table></div>
      ) : <div className="vazio">Nenhuma alteração registrada.</div>}

      <Baixar grupoSlug={slug(grupo)} tipo={t.tipo_tabela} admin={t.administradora} ufPadrao={uf?.uf} />
    </>
  );
}
