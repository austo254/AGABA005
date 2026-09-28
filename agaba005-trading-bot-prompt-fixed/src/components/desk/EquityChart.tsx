"use client";

import { useId, useMemo } from "react";
import { Activity as ChartIcon, TrendingUp } from "lucide-react";
import { bigMoney } from "@/lib/fmt";

export default function EquityChart({ curve, dayStart }: { curve: number[]; dayStart: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const W = 900;
  const H = 190;

  const { d, area, lastX, lastY, min, max, up, hiY, loY } = useMemo(() => {
    if (curve.length < 2) {
      return { d: "", area: "", lastX: 0, lastY: 0, min: dayStart, max: dayStart, up: true, hiY: 0, loY: 0 };
    }
    let mn = Math.min(...curve, dayStart);
    let mx = Math.max(...curve, dayStart);
    const pad = (mx - mn || 1) * 0.18;
    mn -= pad;
    mx += pad;
    const sx = W / (curve.length - 1);
    const sy = (v: number) => H - 8 - ((v - mn) / (mx - mn)) * (H - 16);
    const pts = curve.map((v, i) => [i * sx, sy(v)] as const);
    const dPath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
    const last = pts[pts.length - 1];
    return {
      d: dPath,
      area: `${dPath} L${W},${H} L0,${H} Z`,
      lastX: last[0],
      lastY: last[1],
      min: Math.min(...curve),
      max: Math.max(...curve),
      up: curve[curve.length - 1] >= dayStart,
      hiY: sy(Math.max(...curve)),
      loY: sy(Math.min(...curve)),
    };
  }, [curve, dayStart]);

  const stroke = up ? "#35f2a7" : "#ff4d6d";
  const lastVal = curve[curve.length - 1] ?? dayStart;
  const dayY = useMemo(() => {
    if (curve.length < 2) return 0;
    let mn = Math.min(...curve, dayStart);
    let mx = Math.max(...curve, dayStart);
    const pad = (mx - mn || 1) * 0.18;
    mn -= pad;
    mx += pad;
    return H - 8 - ((dayStart - mn) / (mx - mn)) * (H - 16);
  }, [curve, dayStart]);

  return (
    <section className="panel rise flex min-w-0 flex-col" style={{ animationDelay: "240ms" }}>
      <header className="panel-head justify-between">
        <span className="flex items-center gap-2">
          <ChartIcon size={12} className="text-phos" />
          Equity curve · mark-to-market · M5
        </span>
        <span className="flex items-center gap-3 num">
          <span className="text-dim">LO <b className="text-fog">{bigMoney(min)}</b></span>
          <span className="text-dim">HI <b className="text-fog">{bigMoney(max)}</b></span>
          <span className={up ? "text-phos" : "text-crim"}>{bigMoney(lastVal)}</span>
        </span>
      </header>
      <div className="relative flex-1 px-1 py-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[190px] w-full" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id={`eq${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.22, 0.5, 0.78].map((f) => (
            <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#0e1b22" strokeWidth="1" strokeDasharray="2 6" />
          ))}
          {curve.length > 1 && (
            <>
              <line x1="0" x2={W} y1={dayY} y2={dayY} stroke="#5cc8ff" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="6 5" />
              <path d={area} fill={`url(#eq${id})`} />
              <path d={d} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
              <line x1={lastX} x2={lastX} y1={0} y2={H} stroke={stroke} strokeOpacity="0.25" strokeWidth="1" />
              <circle cx={lastX} cy={lastY} r="3.4" fill={stroke} />
              <circle cx={lastX} cy={lastY} r="7" fill="none" stroke={stroke} strokeOpacity="0.35" />
              <circle cx="0" cy={hiY} r="0" fill="none" />
              <circle cx="0" cy={loY} r="0" fill="none" />
            </>
          )}
        </svg>
        <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded border border-line bg-ink-900/80 px-2 py-1 font-mdata text-[10px] tracking-widest text-dim">
          <TrendingUp size={11} className={up ? "text-phos" : "rotate-180 text-crim"} />
          SESSION DAY REF <span className="text-cyanx">{bigMoney(dayStart)}</span>
        </div>
      </div>
    </section>
  );
}
