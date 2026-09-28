"use client";

import { ListChecks } from "lucide-react";
import type { HistoryTradeDto } from "@/lib/types";
import { money, rFmt } from "@/lib/fmt";

const REASON_TONE: Record<string, string> = {
  TP: "text-phos border-phos/30 bg-phos/10",
  TRAIL: "text-cyanx border-cyanx/30 bg-cyanx/10",
  SL: "text-crim border-crim/30 bg-crim/10",
  SESSION: "text-viol border-viol/30 bg-viol/10",
  MANUAL: "text-amber border-amber/30 bg-amber/10",
};

export default function HistoryTable({ history }: { history: HistoryTradeDto[] }) {
  return (
    <section className="panel rise flex min-h-0 flex-col" style={{ animationDelay: "360ms" }}>
      <header className="panel-head justify-between">
        <span className="flex items-center gap-2">
          <ListChecks size={12} className="text-fog" />
          Closed trade ledger
        </span>
        <span className="num text-dim">{history.length} ROWS</span>
      </header>
      <div className="thin-scroll max-h-[300px] overflow-auto">
        <table className="w-full border-collapse font-mdata text-[10.5px]">
          <thead className="sticky top-0 z-10 bg-ink-900/95 backdrop-blur">
            <tr className="text-left text-[8px] tracking-[0.2em] text-dim">
              <th className="border-b border-line-soft px-3 py-2 font-medium">CLOSED</th>
              <th className="border-b border-line-soft px-2 py-2 font-medium">INSTRUMENT</th>
              <th className="border-b border-line-soft px-2 py-2 font-medium">SIDE</th>
              <th className="border-b border-line-soft px-2 py-2 font-medium">SETUP</th>
              <th className="border-b border-line-soft px-2 py-2 text-right font-medium">ENTRY</th>
              <th className="border-b border-line-soft px-2 py-2 text-right font-medium">EXIT</th>
              <th className="border-b border-line-soft px-2 py-2 font-medium">EXIT VIA</th>
              <th className="border-b border-line-soft px-2 py-2 text-right font-medium">RESULT R</th>
              <th className="border-b border-line-soft px-3 py-2 text-right font-medium">P&L</th>
            </tr>
          </thead>
          <tbody>
            {history.map((t) => {
              const win = t.outcome === "WIN";
              return (
                <tr key={t.id} className="border-b border-line-soft/60 transition-colors hover:bg-ink-850/50">
                  <td className="whitespace-nowrap px-3 py-1.5 text-dim">{t.simClose || t.simOpen}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-bright">{t.symbol}</td>
                  <td className={`px-2 py-1.5 font-semibold ${t.side === "LONG" ? "text-phos" : "text-crim"}`}>{t.side}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-dim">
                    {t.trigger} · <span className="text-cyanx">{t.score}/8</span>
                  </td>
                  <td className="num whitespace-nowrap px-2 py-1.5 text-right text-fog">{t.entry.toFixed(t.decimals)}</td>
                  <td className="num whitespace-nowrap px-2 py-1.5 text-right text-fog">{t.exit.toFixed(t.decimals)}</td>
                  <td className="px-2 py-1.5">
                    <span className={`rounded-sm border px-1.5 py-[1px] text-[9px] font-bold tracking-[0.12em] ${REASON_TONE[t.reason] ?? REASON_TONE.MANUAL}`}>
                      {t.reason}
                    </span>
                  </td>
                  <td className={`num whitespace-nowrap px-2 py-1.5 text-right font-semibold ${win ? "text-phos" : "text-crim"}`}>
                    {rFmt(t.r)}
                  </td>
                  <td className={`num whitespace-nowrap px-3 py-1.5 text-right font-semibold ${win ? "text-phos" : "text-crim"}`}>
                    {money(t.pnl, true)}
                  </td>
                </tr>
              );
            })}
            {history.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center tracking-[0.2em] text-dim">
                  NO CLOSED TRADES YET — LEDGER OPENS WITH THE FIRST EXIT
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
