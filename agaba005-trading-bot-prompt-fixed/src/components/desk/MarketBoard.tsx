"use client";

import { ArrowDownRight, ArrowUpRight, Minus, Radio } from "lucide-react";
import type { MarketCardDto } from "@/lib/types";
import Spark from "./Spark";

const KIND_TONE: Record<string, string> = {
  MAJOR: "text-cyanx border-cyanx/25 bg-cyanx/5",
  MINOR: "text-fog border-line bg-ink-800",
  EXOTIC: "text-amber border-amber/25 bg-amber/5",
  METAL: "text-amber border-amber/30 bg-amber/10",
  ENERGY: "text-viol border-viol/25 bg-viol/5",
};

function ScoreDots({ score, dir }: { score: number; dir: "LONG" | "SHORT" | null }) {
  const tone = dir === "LONG" ? "bg-phos" : dir === "SHORT" ? "bg-crim" : "bg-fog/70";
  return (
    <div className="flex items-center gap-[3px]" title={`Confluence ${score}/8`}>
      {Array.from({ length: 8 }).map((_, i) => (
        <span key={i} className={`h-2.5 w-[3px] rounded-full ${i < score ? tone : "bg-ink-700"}`} />
      ))}
    </div>
  );
}

export default function MarketBoard({ market, threshold }: { market: MarketCardDto[]; threshold: number }) {
  return (
    <section className="panel rise flex h-full min-h-0 flex-col" style={{ animationDelay: "80ms" }}>
      <header className="panel-head justify-between">
        <span className="flex items-center gap-2">
          <Radio size={12} className="text-phos" />
          Market scan · M5
        </span>
        <span className="num text-dim">{market.length} INSTRUMENTS</span>
      </header>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        {market.map((m) => {
          const delta = m.price - m.prev;
          const upDay = m.chgPct >= 0;
          return (
            <div
              key={m.code}
              className="flex items-center gap-3 border-b border-line-soft/70 px-3 py-2 transition-colors hover:bg-ink-850/60"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mdata text-[12px] font-semibold tracking-wide text-bright">{m.code}</span>
                  <span className={`rounded-sm border px-1 py-[1px] font-mdata text-[8px] tracking-[0.14em] ${KIND_TONE[m.kind] ?? KIND_TONE.MINOR}`}>
                    {m.kind}
                  </span>
                  {delta > 0 ? (
                    <ArrowUpRight size={11} className="text-phos" />
                  ) : delta < 0 ? (
                    <ArrowDownRight size={11} className="text-crim" />
                  ) : (
                    <Minus size={11} className="text-dim" />
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 font-mdata text-[9px] tracking-wider text-dim">
                  <span className={m.blocked ? "text-amber/80" : ""}>
                    {m.blocked ? "FILTERED" : m.dir ? `${m.dir} BIAS` : m.trend === "FLAT" ? "RANGE" : `${m.trend} TREND`}
                  </span>
                  <span>SP {m.spread.toFixed(1)}p</span>
                  <span>ATR {m.atrBps.toFixed(1)}bp</span>
                  <span>RSI {m.rsi.toFixed(0)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <ScoreDots score={m.score} dir={m.dir} />
                  {m.score >= threshold && !m.blocked && (
                    <span className="rounded-sm bg-phos/15 px-1 py-[1px] font-mdata text-[8px] tracking-[0.16em] text-phos">
                      QUALIFIED
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={`num font-mdata text-[13px] font-semibold ${delta >= 0 ? "text-bright" : "text-fog"}`}>
                  {m.price.toFixed(m.decimals)}
                </span>
                <span className={`num font-mdata text-[9px] ${upDay ? "text-phos" : "text-crim"}`}>
                  {upDay ? "+" : ""}
                  {m.chgPct.toFixed(2)}%
                </span>
                <Spark data={m.spark} positive={upDay} width={86} height={26} />
              </div>
            </div>
          );
        })}
      </div>
      <footer className="border-t border-line-soft px-3 py-2 font-mdata text-[8px] tracking-[0.18em] text-dim">
        PRIORITY: TIGHT SPREADS × DEEP LIQUIDITY × {threshold}/8 CONFLUENCE
      </footer>
    </section>
  );
}
