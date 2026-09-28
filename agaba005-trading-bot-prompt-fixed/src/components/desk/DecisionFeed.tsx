"use client";

import { useEffect, useRef, type ReactElement } from "react";
import {
  Ban,
  Check,
  FileText,
  MoveDiagonal,
  Radar,
  Slash,
  Target,
  Zap,
} from "lucide-react";
import type { EventDto } from "@/lib/types";
import { px as fmtPx } from "@/lib/fmt";

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function decFor(symbol: string): number {
  if (symbol.includes("JPY")) return 3;
  if (symbol === "XAU/USD" || symbol === "WTI/USD") return 2;
  if (symbol === "NG/USD" || symbol.includes("TRY") || symbol.includes("ZAR")) return symbol === "NG/USD" ? 3 : 4;
  return 5;
}

function Row({ label, value, tone = "text-bright" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mdata text-[8px] tracking-[0.2em] text-dim">{label}</div>
      <div className={`num truncate font-mdata text-[12px] font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function ExecuteCard({ e }: { e: EventDto }) {
  const m = e.meta ?? {};
  const side = str(m.side, "LONG");
  const long = side === "LONG";
  const symbol = str(m.symbol);
  const dec = decFor(symbol);
  const accent = long ? "border-phos/30" : "border-crim/30";
  const tone = long ? "text-phos" : "text-crim";
  const factors = arr(m.factors);
  return (
    <div className={`feed-item rounded-md border ${accent} bg-ink-850/70 p-3`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 font-mdata text-[10px] font-bold tracking-[0.18em] ${tone}`}>
          <Zap size={11} />
          EXECUTED — {side} {symbol}
        </span>
        <span className="rounded-sm border border-cyanx/25 bg-cyanx/10 px-1.5 py-[1px] font-mdata text-[9px] tracking-[0.14em] text-cyanx">
          CONF {num(m.score)}/8 · {str(m.trigger, "STRUCTURE")}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-4 gap-3">
        <Row label="ENTRY" value={fmtPx(num(m.entry), dec)} />
        <Row label={`STOP · ${num(m.slPips).toFixed(1)}p`} value={fmtPx(num(m.sl), dec)} tone="text-crim" />
        <Row label={`TARGET · ${num(m.tpPips).toFixed(1)}p`} value={fmtPx(num(m.tp), dec)} tone="text-phos" />
        <Row label="R : R" value={`1 : ${num(m.rr).toFixed(1)}`} tone="text-cyanx" />
      </div>
      <div className="mt-2 grid grid-cols-4 gap-3 border-t border-line-soft/70 pt-2">
        <Row label="SIZE" value={str(m.sizeLabel, `${num(m.qty).toLocaleString("en-US", { maximumFractionDigits: 0 })}u`)} />
        <Row label="RISK" value={`$${num(m.riskAmt).toLocaleString("en-US", { maximumFractionDigits: 0 })} · ${num(m.riskPct)}%`} tone="text-amber" />
        <Row label="TRAIL PROTOCOL" value={`+1R → ${num(m.trailPips).toFixed(1)}p`} />
        <Row label="SPREAD PAID" value={`${num(m.spread).toFixed(1)}p`} />
      </div>
      {factors.length > 0 && (
        <ul className="mt-2.5 space-y-1 border-t border-line-soft/70 pt-2">
          {factors.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5 font-mdata text-[10px] leading-snug text-fog">
              <Check size={10} className="mt-[2px] shrink-0 text-phos" />
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CloseCard({ e }: { e: EventDto }) {
  const m = e.meta ?? {};
  const pnl = num(m.pnl);
  const win = pnl > 0;
  const reason = str(m.reason, "TP");
  const badge =
    reason === "TP"
      ? "text-phos border-phos/30 bg-phos/10"
      : reason === "TRAIL"
        ? "text-cyanx border-cyanx/30 bg-cyanx/10"
        : "text-crim border-crim/30 bg-crim/10";
  return (
    <div className={`feed-item rounded-md border p-3 ${win ? "border-phos/25 bg-phos/[0.04]" : "border-crim/25 bg-crim/[0.05]"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className={`rounded-sm border px-1.5 py-[1px] font-mdata text-[9px] font-bold tracking-[0.14em] ${badge}`}>
            {reason === "TP" ? "TAKE PROFIT" : reason === "SL" ? "STOP LOSS" : reason === "TRAIL" ? "TRAIL STOP" : reason}
          </span>
          <span className="font-mdata text-[11px] font-semibold text-bright">
            {str(m.side)} {str(m.symbol)}
          </span>
        </span>
        <span className={`num font-mdata text-[14px] font-bold ${win ? "text-phos" : "text-crim"}`}>
          {win ? "+" : ""}${Math.abs(pnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          <span className="ml-1.5 text-[10px] font-medium text-fog">
            {num(m.r) >= 0 ? "+" : ""}
            {num(m.r).toFixed(2)}R
          </span>
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mdata text-[9px] tracking-[0.14em] text-dim">
        <span>
          {fmtPx(num(m.entry), decFor(str(m.symbol)))} → {fmtPx(num(m.exit), decFor(str(m.symbol)))}
        </span>
        <span>
          LEDGER {num(m.wins)}W/{num(m.losses)}L
        </span>
        <span className={num(m.wr) >= 75 ? "text-phos" : "text-amber"}>WIN RATE {num(m.wr).toFixed(1)}%</span>
        <span>
          DAY {num(m.dayW)}W/{num(m.dayL)}L
        </span>
      </div>
    </div>
  );
}

function SignalCard({ e }: { e: EventDto }) {
  const m = e.meta ?? {};
  const side = str(m.side, "LONG");
  const factors = arr(m.factors).slice(0, 3);
  return (
    <div className="feed-item rounded-md border border-cyanx/25 bg-cyanx/[0.05] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mdata text-[10px] font-bold tracking-[0.16em] text-cyanx">
          <Target size={11} />
          SIGNAL QUALIFIED — {side} {str(m.symbol)}
        </span>
        <span className="font-mdata text-[9px] tracking-[0.14em] text-dim">
          {str(m.trigger, "SETUP")} · {num(m.score)}/8
        </span>
      </div>
      {factors.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {factors.map((f, i) => (
            <span key={i} className="rounded-sm border border-line bg-ink-850 px-1.5 py-[2px] font-mdata text-[9px] text-fog">
              {f.split("—")[0].split("—")[0].trim()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ e }: { e: EventDto }) {
  const m = e.meta ?? {};
  const reached = Boolean(m.reached);
  return (
    <div className="feed-item rounded-md border border-viol/30 bg-viol/[0.06] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-mdata text-[10px] font-bold tracking-[0.16em] text-viol">
          <FileText size={11} />
          SESSION REPORT — DAY {num(m.day)}
        </span>
        <span className={`rounded-sm border px-1.5 py-[1px] font-mdata text-[9px] font-bold tracking-[0.14em] ${reached ? "border-phos/30 bg-phos/10 text-phos" : "border-amber/30 bg-amber/10 text-amber"}`}>
          {reached ? "TARGET SECURED" : "SHORTFALL LOGGED"}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mdata text-[10px] num">
        <span className={num(m.pct) >= 0 ? "text-phos" : "text-crim"}>
          {num(m.pct) >= 0 ? "+" : ""}
          {num(m.pct).toFixed(2)}% · {num(m.pnl) >= 0 ? "+" : "-"}${Math.abs(num(m.pnl)).toLocaleString("en-US", { maximumFractionDigits: 0 })}
        </span>
        <span className="text-fog">
          {num(m.trades)} TRADES · {num(m.wins)}W/{num(m.losses)}L
        </span>
        {m.wr != null && <span className={num(m.wr) >= 75 ? "text-phos" : "text-amber"}>WR {num(m.wr).toFixed(1)}%</span>}
        <span className="text-dim">TARGET +{num(m.target)}%</span>
      </div>
      <p className="mt-2 border-l-2 border-viol/40 pl-2 font-mdata text-[10px] italic leading-relaxed text-fog">
        {str(m.note)}
      </p>
    </div>
  );
}

const PLAIN_TONE: Record<string, { icon: ReactElement; cls: string }> = {
  scan: { icon: <Radar size={10} className="mt-[3px] shrink-0 text-dim" />, cls: "text-dim" },
  reject: { icon: <Slash size={10} className="mt-[3px] shrink-0 text-amber/80" />, cls: "text-amber/80" },
  trail: { icon: <MoveDiagonal size={10} className="mt-[3px] shrink-0 text-cyanx" />, cls: "text-cyanx" },
  system: { icon: <Ban size={10} className="mt-[3px] shrink-0 text-amber" />, cls: "text-amber" },
};

export default function DecisionFeed({ events }: { events: EventDto[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastId = events.length ? events[events.length - 1].id : 0;

  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lastId, events.length]);

  return (
    <section className="panel rise flex h-full min-h-0 flex-col" style={{ animationDelay: "160ms" }}>
      <header className="panel-head justify-between">
        <span className="flex items-center gap-2">
          <span className="relative grid size-4 place-items-center">
            <Radar size={12} className="text-phos" />
            <span className="radar-sweep absolute inset-0 rounded-full [background:conic-gradient(from_0deg,rgba(53,242,167,0.35),transparent_60deg)]" />
          </span>
          Decision log · live thesis stream
        </span>
        <span className="num text-dim">{events.length} EVENTS</span>
      </header>
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="thin-scroll min-h-0 flex-1 space-y-2 overflow-y-auto scroll-smooth px-2.5 py-2.5"
      >
        {events.map((e) => {
          const body =
            e.type === "execute" ? (
              <ExecuteCard e={e} />
            ) : e.type === "close" ? (
              <CloseCard e={e} />
            ) : e.type === "signal" ? (
              <SignalCard e={e} />
            ) : e.type === "report" ? (
              <ReportCard e={e} />
            ) : (
              <div className="feed-item flex items-start gap-1.5 px-1 py-0.5">
                {PLAIN_TONE[e.type]?.icon ?? PLAIN_TONE.scan.icon}
                <span className={`font-mdata text-[10.5px] leading-relaxed ${PLAIN_TONE[e.type]?.cls ?? "text-fog"}`}>
                  {e.message}
                </span>
              </div>
            );
          return (
            <div key={e.id}>
              {body}
              <div className="mt-1 pl-1 font-mdata text-[8px] tracking-[0.18em] text-dim/70">{e.simTime ?? ""}</div>
            </div>
          );
        })}
        {events.length === 0 && (
          <div className="grid h-full place-items-center font-mdata text-[10px] tracking-[0.2em] text-dim">
            AWAITING FIRST SCAN…
          </div>
        )}
      </div>
    </section>
  );
}
