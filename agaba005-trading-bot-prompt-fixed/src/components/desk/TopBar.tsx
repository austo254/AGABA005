"use client";

import {
  Activity,
  Crosshair,
  OctagonX,
  Pause,
  Play,
  RefreshCcw,
  ShieldAlert,
  Trophy,
} from "lucide-react";
import type { BotStateDto } from "@/lib/types";
import { bigMoney, pct } from "@/lib/fmt";

function statusMeta(s: BotStateDto): { label: string; cls: string; dot: string } {
  if (!s.running) return { label: "PAUSED — OPERATOR HOLD", cls: "text-amber border-amber/30 bg-amber/10", dot: "bg-amber" };
  if (s.haltedReason === "TARGET_REACHED")
    return { label: "TARGET SECURED — STAND-DOWN", cls: "text-phos border-phos/30 bg-phos/10", dot: "bg-phos" };
  if (s.haltedReason === "RISK_OFF")
    return { label: "RISK-OFF — CIRCUIT BREAKER", cls: "text-crim border-crim/30 bg-crim/10", dot: "bg-crim" };
  if (s.news.active) return { label: `NEWS WINDOW — ${s.news.label ?? "RELEASE"}`, cls: "text-amber border-amber/30 bg-amber/10", dot: "bg-amber" };
  if (s.openCount > 0) return { label: "IN POSITION — MANAGING RISK", cls: "text-cyanx border-cyanx/30 bg-cyanx/10", dot: "bg-cyanx" };
  return { label: "SCANNING FOR CONFLUENCE", cls: "text-phos border-phos/30 bg-phos/10", dot: "bg-phos" };
}

export default function TopBar({
  state,
  onControl,
  busy,
}: {
  state: BotStateDto;
  onControl: (action: string, value?: number) => void;
  busy: boolean;
}) {
  const st = statusMeta(state);
  const targetP = Math.min(1, Math.max(0, state.dailyPct / state.targetPct));
  const up = state.dailyPnl >= 0;

  return (
    <header className="panel rise flex flex-wrap items-stretch gap-x-5 gap-y-3 px-4 py-3">
      {/* identity */}
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-md border border-line bg-ink-850">
          <Crosshair size={20} className="text-phos" />
        </div>
        <div>
          <div className="font-disp text-lg font-bold leading-none tracking-[0.18em] text-bright">
            AGABA<span className="text-phos">005</span>
          </div>
          <div className="mt-1 font-mdata text-[9px] tracking-[0.3em] text-dim">
            AUTONOMOUS FX & COMMODITIES DESK
          </div>
        </div>
      </div>

      <div className="hidden w-px self-stretch bg-line-soft md:block" />

      {/* status */}
      <div className="flex flex-col justify-center gap-1.5">
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mdata text-[10px] tracking-[0.18em] ${st.cls}`}>
          <span className={`size-1.5 rounded-full ${st.dot} ${state.haltedReason === "RISK_OFF" ? "beacon-red" : "beacon"}`} />
          {st.label}
        </span>
        <span className="font-mdata text-[9px] tracking-[0.2em] text-dim">
          FLOOR {state.threshold}/8 CONFLUENCE · RISK {state.riskPct}%/TRADE · RR ≥ 1:2
        </span>
      </div>

      <div className="hidden w-px self-stretch bg-line-soft md:block" />

      {/* equity + daily */}
      <div className="flex items-center gap-5">
        <div>
          <div className="font-mdata text-[9px] tracking-[0.28em] text-dim">EQUITY · MARK-TO-MARKET</div>
          <div className="num font-mdata text-[22px] font-semibold leading-tight text-bright">
            {bigMoney(state.equityLive)}
          </div>
        </div>
        <div className="min-w-[190px]">
          <div className="flex items-center justify-between font-mdata text-[9px] tracking-[0.2em] text-dim">
            <span>DAY P&L</span>
            <span className={up ? "text-phos" : "text-crim"}>
              {state.dailyPnl >= 0 ? "+" : ""}
              {bigMoney(state.dailyPnl)} ({pct(state.dailyPct)})
            </span>
          </div>
          <div className="relative mt-1.5 h-2 overflow-hidden rounded-full border border-line bg-ink-850">
            <div
              className={`h-full rounded-full transition-all duration-700 ${up ? "bg-gradient-to-r from-phos-dim to-phos" : "bg-gradient-to-r from-crim/60 to-crim"}`}
              style={{ width: `${Math.round(targetP * 100)}%` }}
            />
            <div className="absolute inset-y-0 right-0 w-px bg-fog/40" title="target" />
          </div>
          <div className="mt-1 flex items-center justify-between font-mdata text-[9px] tracking-[0.18em] text-dim">
            <span>0%</span>
            <span className={state.dailyPct >= state.targetPct ? "text-phos" : ""}>
              {state.dailyPct >= state.targetPct ? "TARGET SECURED" : `TARGET +${state.targetPct}%`}
            </span>
          </div>
        </div>
      </div>

      <div className="hidden w-px self-stretch bg-line-soft lg:block" />

      {/* clock */}
      <div className="hidden flex-col justify-center lg:flex">
        <div className="font-mdata text-[9px] tracking-[0.28em] text-dim">MARKET CLOCK</div>
        <div className="num font-mdata text-[15px] font-semibold text-bright">
          D{state.dayIndex} · {state.clock.time} <span className="text-[10px] text-dim">UTC</span>
          <span className="blink-dot ml-1 inline-block size-1.5 rounded-full bg-phos align-middle" />
        </div>
        <div className="font-mdata text-[9px] tracking-[0.2em] text-dim">
          {state.clock.date} · {state.clock.session}
        </div>
      </div>

      {/* controls */}
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => onControl(state.running ? "stop" : "start")}
          disabled={busy}
          className={`flex items-center gap-1.5 rounded-md border px-3 py-2 font-mdata text-[10px] tracking-[0.16em] transition-colors disabled:opacity-40 ${
            state.running
              ? "border-amber/40 bg-amber/10 text-amber hover:bg-amber/20"
              : "border-phos/40 bg-phos/10 text-phos hover:bg-phos/20"
          }`}
        >
          {state.running ? <Pause size={12} /> : <Play size={12} />}
          {state.running ? "PAUSE" : "RESUME"}
        </button>
        <div className="flex overflow-hidden rounded-md border border-line">
          {[1, 1.5, 2].map((r) => (
            <button
              key={r}
              onClick={() => onControl("risk", r)}
              disabled={busy}
              className={`px-2.5 py-2 font-mdata text-[10px] transition-colors disabled:opacity-40 ${
                state.riskPct === r ? "bg-cyanx/15 text-cyanx" : "text-dim hover:text-fog"
              }`}
              title={`Risk ${r}% per trade`}
            >
              {r}%
            </button>
          ))}
        </div>
        <button
          onClick={() => onControl("flatten")}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-2 font-mdata text-[10px] tracking-[0.16em] text-fog transition-colors hover:border-crim/40 hover:text-crim disabled:opacity-40"
          title="Close all open positions at market"
        >
          <OctagonX size={12} />
          FLATTEN
        </button>
        <button
          onClick={() => {
            if (window.confirm("Reset account to $100,000 and clear the full trade ledger?")) onControl("reset");
          }}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-2 font-mdata text-[10px] tracking-[0.16em] text-dim transition-colors hover:text-fog disabled:opacity-40"
          title="Reset account"
        >
          <RefreshCcw size={12} />
        </button>
      </div>

      {/* halted banners */}
      {state.haltedReason === "TARGET_REACHED" && (
        <div className="flex w-full items-center gap-2 rounded-md border border-phos/25 bg-phos/5 px-3 py-2 font-mdata text-[10px] tracking-[0.12em] text-phos">
          <Trophy size={12} /> DAILY OBJECTIVE +{state.targetPct}% BANKED — desk ceased trading per protocol. Resumes automatically at next session open.
        </div>
      )}
      {state.haltedReason === "RISK_OFF" && (
        <div className="flex w-full items-center gap-2 rounded-md border border-crim/25 bg-crim/5 px-3 py-2 font-mdata text-[10px] tracking-[0.12em] text-crim">
          <ShieldAlert size={12} /> DAILY LOSS GUARD TRIPPED — no fresh exposure until next session. Post-mortem queued for rejected and stopped trades.
        </div>
      )}
      {state.news.active && !state.haltedReason && (
        <div className="flex w-full items-center gap-2 rounded-md border border-amber/25 bg-amber/5 px-3 py-2 font-mdata text-[10px] tracking-[0.12em] text-amber">
          <Activity size={12} /> HIGH-IMPACT RELEASE — {state.news.label ?? "MACRO DATA"} · entries frozen for ~{state.news.endsInMin}m · existing risk protected at structure
        </div>
      )}
    </header>
  );
}
