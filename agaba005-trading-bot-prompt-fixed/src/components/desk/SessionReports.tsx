"use client";

import { CalendarClock, CheckCircle2, AlertTriangle } from "lucide-react";
import type { ReportDto } from "@/lib/types";

export default function SessionReports({ reports }: { reports: ReportDto[] }) {
  return (
    <section className="panel rise flex h-full min-h-0 flex-col" style={{ animationDelay: "320ms" }}>
      <header className="panel-head justify-between">
        <span className="flex items-center gap-2">
          <CalendarClock size={12} className="text-viol" />
          Session debriefs · +20% daily objective
        </span>
        <span className="num text-dim">{reports.filter((r) => !r.live).length} FILED</span>
      </header>
      <div className="thin-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
        {reports.map((r, i) => (
          <article
            key={`${r.day}-${r.live ? "live" : "filed"}-${i}`}
            className={`rounded-md border p-3 ${
              r.live ? "border-cyanx/30 bg-cyanx/[0.05]" : r.reached ? "border-phos/25 bg-phos/[0.03]" : "border-amber/25 bg-amber/[0.03]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-mdata text-[10px] font-bold tracking-[0.16em] text-bright">
                {r.live && <span className="beacon inline-block size-1.5 rounded-full bg-cyanx" />}
                DAY {r.day} {r.live ? "— LIVE" : ""}
              </span>
              <span
                className={`flex items-center gap-1.5 rounded-sm border px-1.5 py-[1px] font-mdata text-[9px] font-bold tracking-[0.12em] ${
                  r.live
                    ? "border-cyanx/30 bg-cyanx/10 text-cyanx"
                    : r.reached
                      ? "border-phos/30 bg-phos/10 text-phos"
                      : "border-amber/30 bg-amber/10 text-amber"
                }`}
              >
                {r.live ? null : r.reached ? <CheckCircle2 size={9} /> : <AlertTriangle size={9} />}
                {r.pct >= 0 ? "+" : ""}
                {r.pct.toFixed(2)}% / +{r.target}%
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 font-mdata text-[9px] tracking-[0.12em] text-dim">
              <span className={r.pnl >= 0 ? "text-phos" : "text-crim"}>
                {r.pnl >= 0 ? "+" : "-"}${Math.abs(r.pnl).toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>
              <span>{r.trades} TRADES</span>
              <span>
                {r.wins}W/{r.losses}L
              </span>
              {r.wr != null && <span className={r.wr >= 75 ? "text-phos" : "text-amber"}>WR {r.wr.toFixed(1)}%</span>}
            </div>
            <p className="mt-1.5 font-mdata text-[9px] italic leading-relaxed text-dim">{r.note}</p>
          </article>
        ))}
        {reports.length === 0 && (
          <div className="grid h-full min-h-[120px] place-items-center font-mdata text-[9px] tracking-[0.2em] text-dim">
            FIRST DEBRIEF FILES AT SESSION CLOSE
          </div>
        )}
      </div>
      <footer className="border-t border-line-soft px-3 py-2 font-mdata text-[8px] tracking-[0.18em] text-dim">
        SHORTFALLS LOGGED WITH MISSED / REJECTED SETUP ANALYSIS
      </footer>
    </section>
  );
}
