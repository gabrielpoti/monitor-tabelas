// Gráfico de linha simples em SVG (sem bibliotecas).
import { brl, dataBR } from '@/lib/util';

export default function Grafico({ pontos, altura = 180 }) {
  if (!pontos?.length) return <div className="vazio">Sem histórico ainda. O primeiro ponto é gravado na primeira conferência diária e um novo ponto a cada mudança de preço.</div>;
  const L = 640, A = altura, m = { e: 70, d: 16, t: 14, b: 28 };
  const xs = pontos.map((p) => new Date(p.data).getTime());
  const ys = pontos.map((p) => Number(p.valor));
  const hoje = Date.now();
  const x0 = Math.min(...xs), x1 = Math.max(hoje, ...xs);
  const y0 = Math.min(...ys) * 0.97, y1 = Math.max(...ys) * 1.03 || 1;
  const X = (x) => m.e + ((x - x0) / Math.max(1, x1 - x0)) * (L - m.e - m.d);
  const Y = (y) => m.t + (1 - (y - y0) / Math.max(0.01, y1 - y0)) * (A - m.t - m.b);
  // degraus: o preço vale até a próxima mudança
  let d = '';
  pontos.forEach((p, i) => {
    const x = X(xs[i]), y = Y(ys[i]);
    d += i === 0 ? `M${x},${y}` : `H${x}V${y}`;
  });
  d += `H${X(x1)}`;
  return (
    <svg viewBox={`0 0 ${L} ${A}`} style={{ width: '100%', maxWidth: L, background: '#fff', border: '1px solid var(--borda)', borderRadius: 10 }} role="img" aria-label="Histórico de preço">
      {[y0, (y0 + y1) / 2, y1].map((v, i) => (
        <g key={i}><line x1={m.e} x2={L - m.d} y1={Y(v)} y2={Y(v)} stroke="#eef0f3" /><text x={m.e - 6} y={Y(v) + 4} fontSize="11" textAnchor="end" fill="#5f6b7a">{brl(v)}</text></g>
      ))}
      <path d={d} fill="none" stroke="#0b6bcb" strokeWidth="2.5" />
      {pontos.map((p, i) => <circle key={i} cx={X(xs[i])} cy={Y(ys[i])} r="4" fill="#0b6bcb"><title>{`${dataBR(p.data)}: ${brl(p.valor)}`}</title></circle>)}
      <text x={m.e} y={A - 8} fontSize="11" fill="#5f6b7a">{dataBR(x0)}</text>
      <text x={L - m.d} y={A - 8} fontSize="11" fill="#5f6b7a" textAnchor="end">hoje</text>
    </svg>
  );
}
