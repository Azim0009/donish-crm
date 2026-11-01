import { useMemo, useState } from "react";
import { weekTotal, hasData, monthResult, PALETTE, PASS } from "../scoring.js";

const W = 760, H = 280, L = 40, R = 24, T = 16, B = 34;
const X = ["Нед. 1", "Нед. 2", "Нед. 3", "Нед. 4", "Средний"];
const x = (i) => L + (i * (W - L - R)) / (X.length - 1);
const y = (v) => T + (1 - v / 100) * (H - T - B);

// Плавная линия через точки (Catmull-Rom → Безье)
function smooth(pts) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export default function ScoreChart({ students, scores, extra }) {
  const [hover, setHover] = useState(null);
  const series = useMemo(() => students.map((s, i) => {
    const weeks = [1, 2, 3, 4].map((w) => scores[`${s.id}-${w}`] || null);
    const r = monthResult(weeks, extra?.[s.id]);
    const pts = weeks.map((w, k) => (hasData(w) ? [x(k), y(weekTotal(w)), weekTotal(w)] : null)).filter(Boolean);
    if (r.pace != null) pts.push([x(4), y(r.pace), r.pace]);
    return { s, color: PALETTE[i % PALETTE.length], pts, pace: r.pace };
  }).sort((a, b) => (b.pace ?? -1) - (a.pace ?? -1)), [students, scores, extra]);

  const any = series.some((z) => z.pts.length);

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <div><div className="eyebrow">Динамика месяца</div><h2>Баллы по неделям</h2></div>
        <span className="muted small">линия 80 — порог перехода</span>
      </div>
      <div className="chart-body">
        <div className="chart-svg">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="График баллов учеников по неделям">
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid-line" />
                <text x={L - 8} y={y(v) + 4} textAnchor="end" className="axis">{v}</text>
              </g>
            ))}
            <line x1={L} x2={W - R} y1={y(PASS)} y2={y(PASS)} className="pass-line" />
            {X.map((t, i) => (
              <g key={t}>
                <line x1={x(i)} x2={x(i)} y1={T} y2={H - B} className="grid-line v" />
                <text x={x(i)} y={H - 10} textAnchor="middle" className="axis">{t}</text>
              </g>
            ))}
            {series.map((z, i) => (
              <g key={z.s.id} className={"series" + (hover && hover !== z.s.id ? " dim" : "") + (hover === z.s.id ? " hot" : "")}
                onMouseEnter={() => setHover(z.s.id)} onMouseLeave={() => setHover(null)}>
                {z.pts.length > 1 && <path d={smooth(z.pts)} stroke={z.color} pathLength="1" className="line" style={{ animationDelay: `${i * 60}ms` }} />}
                {z.pts.map((p, k) => <circle key={k} cx={p[0]} cy={p[1]} r="4" fill={z.color} className="dot"><title>{`${z.s.fullName}: ${p[2]}`}</title></circle>)}
              </g>
            ))}
          </svg>
          {!any && <div className="chart-empty">Заполните журнал — здесь появятся линии учеников</div>}
        </div>
        <ol className="legend">
          {series.map((z, i) => (
            <li key={z.s.id} onMouseEnter={() => setHover(z.s.id)} onMouseLeave={() => setHover(null)} className={hover === z.s.id ? "hot" : ""}>
              <span className="pos num">{i + 1}</span>
              <i style={{ background: z.color }} />
              <span className="nm">{z.s.fullName}</span>
              <b className="num" style={{ color: z.pace == null ? "var(--muted)" : z.pace >= PASS ? "var(--pass)" : z.pace >= 75 ? "var(--extra)" : "var(--fail)" }}>{z.pace ?? "—"}</b>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
