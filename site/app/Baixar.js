// Formulário de download da planilha de preços (todas as cidades ou uma cidade).
const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

export default function Baixar({ grupoSlug, tipo, admin, cidadePadrao, ufPadrao }) {
  const extra = { ...(tipo ? { tipo } : {}), ...(admin ? { admin } : {}) };
  const todas = new URLSearchParams({ ...(grupoSlug ? { grupo: grupoSlug } : {}), ...extra }).toString();
  return (
    <div className="cartao" style={{ margin: '1rem 0' }}>
      <h3>Baixar planilha</h3>
      <p className="pequeno" style={{ marginTop: 0 }}>Abas: preços por faixa etária, tabelas e planos, coparticipação, carência, área de comercialização e rede credenciada (rede só para uma cidade). Os filtros de tipo e administradora acima também valem.</p>
      <div className="linha">
        <a className="botao" href={`/api/planilha?${todas}`}>Todas as cidades</a>
        <span className="pequeno">ou</span>
        <form action="/api/planilha" method="get" className="linha">
          {grupoSlug && <input type="hidden" name="grupo" value={grupoSlug} />}
          {Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input name="cidade" placeholder="Cidade (ex.: Fortaleza)" defaultValue={cidadePadrao || ''} required style={{ minWidth: 190 }} />
          <select name="uf" defaultValue={ufPadrao || ''}><option value="">UF</option>{UFS.map((u) => <option key={u}>{u}</option>)}</select>
          <button type="submit">Baixar 1 cidade</button>
        </form>
      </div>
    </div>
  );
}
