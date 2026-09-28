"use client";

import { Gauge, MoveDiagonal, TrendingDown, TrendingUp } from "lucide-react";
import type { PositionDto } from "@/lib/types";
import { px as fmtPx, rFmt, money } from "@/lib/fmt";

function decFor(symbol: string): number {
  if (symbol.includes("JPY")) return 3;
  if (symbol === "XAU/USD" || symbol === "WTI/USD") return 2;
  if (symbol === "NG/USD") return 3;
  if (symbol.includes("TRY") || symbol.includes("ZAR")) return 4;
  return 5;
}

function Rail({ p }: { p: PositionDto }) {
  const span = p.takeProfit - p.stopLoss || 1;
  const entryPct = Math.min(100, Math.max(0, ((p.entry - p.stopLoss) / span) * 100));
  const markPct = Math.min(100, Math.max(0, p.live.pctToTp * 100));
  const stopPct = Math.min(100, Math.max(0, ((p.currentStop - p.stopLoss) / span) * 100));
  const long = p.side === "LONG";
  return (
    <div className="relative mt-2 h-7">
      <div className="absolute inset-x-0 top-3 h-[6px] overflow-hidden rounded-full border border-line bg-ink-850">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-crim/50 via-ink-700 to-phos/60"
          style={{ width: "100%" }}
        />
        <div
          className={`absolute inset-y-0 left-0 ${p.trailingActive ? "bg-cyanx/45" : "bg-amber/30"}`}
          style={{ width: `${stopPct}%` }}
        />
      </div>
      {/* entry tick */}
      <div className="absolute top-1.5 h-[14px] w-px bg-fog/70" style={{ left: `${entryPct}%` }} />
      {/* mark */}
      <div
        className="absolute top-0 transition-all duration-500"
        style={{ left: `calc(${markPct}% - 5px)` }}
      >
        {long ? (
          <TrendingUp size={10} className={p.live.pnl >= 0 ? "text-phos" : "text-crim"} />
        ) : (
          <TrendingDown size={10} className={p.live.pnl >= 0 ? "text-phos" : "text-crim"} />
        )}
      </div>
      <div className="absolute inset-x-0 top-5 flex justify-between font-mdata text-[8px] tracking-[0.12em] text-dim">
        <span>SL {fmtPx(p.stopLoss, decFor(p.symbol))}</span>
        <span>TP {fmtPx(p.takeProfit, decFor(p.symbol))}</span>
      </div>
    </div>
  );
}

export default function PositionsPanel({ positions }: { positions: PositionDto[] }) {
  const exposure = positions.reduce((a, p) => a + p.riskAmt, 0);
  return (
    <section className="panel rise flex min-h-0 flex-col" style={{ animationDelay: "200ms" }}>
      <header className="panel-head justify-between">
        <span className="flex items-center gap-2">
          <Gauge size={12} className="text-cyanx" />
          Open risk · managed live
        </span>
        <span className="num text-dim">
          {positions.length} POS · {money(exposure)} AT RISK
        </span>
      </header>
      <div className="thin-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {positions.map((p) => {
          const win = p.live.pnl >= 0;
          const long = p.side === "LONG";
          return (
            <article key={p.id} className={`rounded-md border p-3 ${win ? "border-phos/25 bg-phos/[0.03]" : "border-crim/25 bg-crim/[0.04]"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-sm border px-1.5 py-[1px] font-mdata text-[9px] font-bold tracking-[0.14em] ${long ? "border-phos/30 bg-phos/10 text-phos" : "border-crim/30 bg-crim/10 text-crim"}`}>
                    {p.side}
                  </span>
                  <span className="font-mdata text-[13px] font-bold text-bright">{p.symbol}</span>
                  <span className="font-mdata text-[9px] text-dim">{p.size}</span>
                </div>
                <span className={`num font-mdata text-[15px] font-bold ${win ? "text-phos" : "text-crim"}`}>
                  {win ? "+" : ""}
                  {money(p.live.pnl)}
                  <span className="ml-1.5 text-[10px] font-medium text-fog">{rFmt(p.live.r)}</span>
                </span>
              </div>

              <Rail p={p} />

              <div className="mt-2 grid grid-cols-4 gap-2 border-t border-line-soft/70 pt-2">
                <div>
                  <div className="font-mdata text-[8px] tracking-[0.16em] text-dim">ENTRY</div>
                  <div className="num font-mdata text-[11px] font-semibold text-bright">{fmtPx(p.entry, decFor(p.symbol))}</div>
                </div>
                <div>
                  <div className="font-mdata text-[8px] tracking-[0.16em] text-dim">MARK</div>
                  <div className={`num font-mdata text-[11px] font-semibold ${win ? "text-phos" : "text-crim"}`}>{fmtPx(p.live.mark, decFor(p.symbol))}</div>
                </div>
                <div>
                  <div className="font-mdata text-[8px] tracking-[0.16em] text-dim">P&L PIPS</div>
                  <div className={`num font-mdata text-[11px] font-semibold ${win ? "text-phos" : "text-crim"}`}>
                    {p.live.pipGain >= 0 ? "+" : ""}
                    {p.live.pipGain.toFixed(1)}
                  </div>
                </div>
                <div>
                  <div className="font-mdata text-[8px] tracking-[0.16em] text-dim">R : R PLAN</div>
                  <div className="num font-mdata text-[11px] font-semibold text-cyanx">1 : {p.rr.toFixed(1)}</div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mdata text-[9px] tracking-[0.12em] text-dim">
                <span className="rounded-sm border border-line bg-ink-850 px-1.5 py-[1px] text-fog">
                  {p.trigger} · CONF {p.score}/8
                </span>
                {p.trailingActive ? (
                  <span className="flex items-center gap-1 text-cyanx">
                    <MoveDiagonal size={9} /> TRAIL LIVE → {fmtPx(p.currentStop, decFor(p.symbol))} · {p.trailDistPips.toFixed(1)}p
                  </span>
                ) : (
                  <span>trail arms at +1R</span>
                )}
                <span>{p.simOpen}</span>
              </div>
            </article>
          );
        })}
        {positions.length === 0 && (
          <div className="grid h-full min-h-[180px] place-items-center rounded-md border border-dashed border-line text-center">
            <div>
              <div className="font-mdata text-[11px] tracking-[0.24em] text-dim">DESK FLAT</div>
              <div className="mx-auto mt-2 max-w-[220px] font-mdata text-[9px] leading-relaxed tracking-[0.1em] text-dim/80">
                No exposure. Waiting for confluence to clear the floor — low-conviction setups are rejected regardless of upside.
              </div>
            </div>
          </div>
        )}
      </div>
      <footer className="border-t border-line-soft px-3 py-2 font-mdata text-[8px] tracking-[0.18em] text-dim">
        TRAIL PROTOCOL: ARMS +1R · RATCHETS ON STRENGTH · NEVER WIDENS
      </footer>
    </section>
  );
}
