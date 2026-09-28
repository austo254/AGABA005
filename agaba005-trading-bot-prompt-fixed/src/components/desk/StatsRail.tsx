"use client";

import { Activity, Scale } from "lucide-react";
import type { StatsDto } from "@/lib/types";
import { rFmt } from "@/lib/fmt";

function Gauge({ wr, floor }: { wr: number | null; floor: number }) {
  const v = wr ?? 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  const frac = Math.min(1, v / 100);
  const floorFrac = floor / 100;
  const floorAngle = floorFrac * 2 * Math.PI - Math.PI / 2;
  const fx = 70 + Math.cos(floorAngle) * (R + 7);
  const fy = 70 + Math.sin(floorAngle) * (R + 7);
  const ok = (wr ?? 0) >= floor;
  const color = wr == null ? "#5d7269" : ok ? "#35f2a7" : "#ffc24d";
  return (
    <div className="relative mx-auto w-fit">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#0e1c23" strokeWidth="9" />
        <circle
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${frac * C} ${C}`}
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dasharray 0.7s ease, stroke 0.4s ease" }}
        />
        <line x1="70" y1="70" x2={fx} y2={fy} stroke="#ffc24d" strokeWidth="1.4" strokeDasharray="2 3" />
        <circle cx="70" cy="70" r="2.5" fill="#9db3a8" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num font-mdata text-[24px] font-bold leading-none" style={{ color }}>
          {wr == null ? "—" : `${wr.toFixed(1)}%`}
        </span>
        <span className="mt-1 font-mdata text-[8px] tracking-[0.22em] text-dim">LIFETIME WR</span>
      </div>
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap font-mdata text-[8px] tracking-[0.18em] text-amber">
        FLOOR {floor}%
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "text-bright" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md border border-line-soft bg-ink-850/60 px-2.5 py-2">
      <div className="font-mdata text-[8px] tracking-[0.18em] text-dim">{label}</div>
      <div className={`num mt-0.5 font-mdata text-[14px] font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default function StatsRail({ stats, threshold }: { stats: StatsDto; threshold: number }) {
  const wrTone = stats.wr == null ? "text-fog" : stats.wr >= 75 ? "text-phos" : "text-amber";
  return (
    <section className="panel rise flex min-h-0 flex-col" style={{ animationDelay: "280ms" }}>
      <header className="panel-head justify-between">
        <span className="flex items-center gap-2">
          <Scale size={12} className="text-phos" />
          Performance ledger
        </span>
        <span className="num text-dim">{stats.trades} LIFETIME</span>
      </header>
      <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="flex items-center gap-4">
          <Gauge wr={stats.wr} floor={75} />
          <div className="flex-1 space-y-2">
            <div>
              <div className="flex justify-between font-mdata text-[8px] tracking-[0.18em] text-dim">
                <span>LAST-20 WIN RATE</span>
                <span className={stats.wr20 == null ? "text-dim" : stats.wr20 >= 75 ? "text-phos" : "text-amber"}>
                  {stats.wr20 == null ? "FORMING" : `${stats.wr20.toFixed(0)}%`}
                </span>
              </div>
              <div className="mt-1 flex gap-[3px]">
                {Array.from({ length: 20 }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-2 flex-1 rounded-full ${i < stats.sample20 ? (stats.wr != null && stats.wr >= 75 ? "bg-phos/70" : "bg-amber/70") : "bg-ink-700"}`}
                  />
                ))}
              </div>
              <div className="mt-1 font-mdata text-[8px] tracking-[0.14em] text-dim">
                SAMPLE {stats.sample20}/20 {stats.sample20 < 20 ? "· evaluation locked until 20-trade minimum" : "· live evaluation window"}
              </div>
            </div>
            <div className="rounded-md border border-line-soft bg-ink-850/60 px-2.5 py-1.5 font-mdata text-[9px] leading-relaxed tracking-[0.08em]">
              <span className="text-dim">ADAPTIVE CRITERIA — </span>
              <span className="text-cyanx">confluence floor {threshold}/8</span>
              <span className="text-dim"> · auto-tightens if WR &lt; 75%</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat label="EXPECTANCY" value={stats.expectancyR == null ? "—" : rFmt(stats.expectancyR)} tone={stats.expectancyR == null ? "text-fog" : stats.expectancyR >= 0 ? "text-phos" : "text-crim"} />
          <Stat label="PROFIT FACTOR" value={stats.pf == null ? "—" : stats.pf.toFixed(2)} tone={stats.pf == null ? "text-fog" : stats.pf >= 1.5 ? "text-phos" : "text-fog"} />
          <Stat label="W / L" value={`${stats.wins} / ${stats.losses}`} tone={wrTone} />
          <Stat label="AVG WIN" value={stats.avgWinR == null ? "—" : rFmt(stats.avgWinR)} tone="text-phos" />
          <Stat label="AVG LOSS" value={stats.avgLossR == null ? "—" : rFmt(stats.avgLossR)} tone="text-crim" />
          <Stat label="BEST / WORST" value={stats.bestR == null ? "—" : `${rFmt(stats.bestR)} / ${rFmt(stats.worstR ?? 0)}`} />
        </div>

        <div className="rounded-md border border-line-soft bg-ink-850/60 px-3 py-2">
          <div className="flex items-center gap-2 font-mdata text-[8px] tracking-[0.2em] text-dim">
            <Activity size={10} className="text-cyanx" />
            TODAY — SESSION R
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className={`num font-mdata text-[16px] font-bold ${stats.realizedDayR >= 0 ? "text-phos" : "text-crim"}`}>
              {rFmt(stats.realizedDayR)}
            </span>
            <span className="font-mdata text-[9px] tracking-[0.14em] text-dim">
              {stats.dayTrades} TRADES · {stats.dayWins}W/{stats.dayLosses}L
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
