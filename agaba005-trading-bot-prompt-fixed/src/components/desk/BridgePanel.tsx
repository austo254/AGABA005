"use client";

import { Cable, Download, Link2, Unplug, ArrowLeftRight, Server, Waypoints } from "lucide-react";
import type { BridgeDto } from "@/lib/types";
import { bigMoney } from "@/lib/fmt";

function Row({ k, v, tone = "text-bright" }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line-soft/60 py-1.5 last:border-0">
      <span className="font-mdata text-[9px] tracking-[0.18em] text-dim">{k}</span>
      <span className={`num truncate font-mdata text-[11px] font-semibold ${tone}`}>{v}</span>
    </div>
  );
}

export default function BridgePanel({
  bridge,
  onControl,
  busy,
}: {
  bridge: BridgeDto;
  onControl: (action: string, value?: number | string) => void;
  busy: boolean;
}) {
  const linked = bridge.mode === "LINKED";
  const up = bridge.connected;

  return (
    <section className="panel rise flex h-full min-h-0 flex-col" style={{ animationDelay: "400ms" }}>
      <header className="panel-head justify-between">
        <span className="flex items-center gap-2">
          <Cable size={12} className={linked ? "text-cyanx" : "text-dim"} />
          MT5 bridge · FP Markets link
        </span>
        <a
          href="/Agaba005Bridge.mq5"
          download="Agaba005Bridge.mq5"
          className="flex items-center gap-1.5 rounded-sm border border-cyanx/30 bg-cyanx/10 px-2 py-[3px] font-mdata text-[9px] tracking-[0.14em] text-cyanx transition-colors hover:bg-cyanx/20"
        >
          <Download size={10} />
          EA .MQ5
        </a>
      </header>

      <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {/* mode switch */}
        <div>
          <div className="mb-1.5 flex items-center gap-2 font-mdata text-[8px] tracking-[0.2em] text-dim">
            <ArrowLeftRight size={10} /> EXECUTION MODE
          </div>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line">
            <button
              onClick={() => onControl("mode", "SIM")}
              disabled={busy}
              className={`px-3 py-2.5 font-mdata text-[10px] font-bold tracking-[0.16em] transition-colors disabled:opacity-40 ${
                !linked ? "bg-phos/15 text-phos" : "text-dim hover:text-fog"
              }`}
            >
              SIMULATION
            </button>
            <button
              onClick={() => {
                if (window.confirm("Switch to MT5 LINKED mode? Open positions will be flattened, and the engine will start routing orders to your terminal once the EA heartbeats in.")) {
                  onControl("mode", "LINKED");
                }
              }}
              disabled={busy}
              className={`px-3 py-2.5 font-mdata text-[10px] font-bold tracking-[0.16em] transition-colors disabled:opacity-40 ${
                linked ? "bg-cyanx/15 text-cyanx" : "text-dim hover:text-fog"
              }`}
            >
              MT5 LINKED
            </button>
          </div>
        </div>

        {/* link state */}
        <div
          className={`flex items-center gap-2.5 rounded-md border px-3 py-2.5 ${
            !linked
              ? "border-line bg-ink-850/60"
              : up
                ? "border-phos/30 bg-phos/[0.06]"
                : "border-amber/30 bg-amber/[0.06]"
          }`}
        >
          {linked ? (
            <span className={`grid size-8 place-items-center rounded-md border ${up ? "border-phos/30 bg-phos/10" : "border-amber/30 bg-amber/10"}`}>
              <Link2 size={14} className={up ? "text-phos" : "text-amber"} />
            </span>
          ) : (
            <span className="grid size-8 place-items-center rounded-md border border-line bg-ink-800">
              <Unplug size={14} className="text-dim" />
            </span>
          )}
          <div className="min-w-0">
            <div className={`font-mdata text-[11px] font-bold tracking-[0.14em] ${!linked ? "text-fog" : up ? "text-phos" : "text-amber"}`}>
              {!linked
                ? "INTERNAL FEED ACTIVE"
                : up
                  ? `TERMINAL CONNECTED ${bridge.staleSec <= 6 ? "· LIVE" : `· ${bridge.staleSec}s AGO`}`
                  : bridge.staleSec < 0
                    ? "WAITING FOR FIRST HEARTBEAT"
                    : `LINK STALE — ${bridge.staleSec}s SILENT`}
            </div>
            <div className="font-mdata text-[9px] tracking-[0.12em] text-dim">
              {!linked
                ? "engine paper-fills on the internal feed — no broker involved"
                : up
                  ? "quotes streaming · orders routing through your terminal"
                  : "attach Agaba005Bridge.mq5 on a chart and whitelist this app's URL"}
            </div>
          </div>
        </div>

        {/* terminal details */}
        <div className="rounded-md border border-line-soft bg-ink-850/60 px-3 py-2">
          <div className="flex items-center gap-2 pb-1 font-mdata text-[8px] tracking-[0.2em] text-dim">
            <Server size={10} className="text-cyanx" /> TERMINAL
          </div>
          <Row k="ACCOUNT" v={bridge.account ?? "—"} />
          <Row k="SERVER" v={bridge.server ?? "—"} tone="text-cyanx" />
          <Row k="BROKER" v={bridge.company ?? "—"} />
          <Row k="EQUITY" v={bridge.equity != null ? bigMoney(bridge.equity) : "—"} tone="text-phos" />
          <Row k="BALANCE" v={bridge.balance != null ? bigMoney(bridge.balance) : "—"} />
          <Row k="FREE MARGIN" v={bridge.marginFree != null ? bigMoney(bridge.marginFree) : "—"} />
          <Row k="BROKER POSITIONS" v={String(bridge.posCount)} />
          <Row k="HEARTBEATS" v={String(bridge.hbs)} />
        </div>

        {/* order pipeline */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { k: "ROUTED", v: bridge.sent, tone: "text-cyanx" },
            { k: "FILLED", v: bridge.acked, tone: "text-phos" },
            { k: "REFUSED", v: bridge.failed, tone: bridge.failed > 0 ? "text-crim" : "text-fog" },
            { k: "AWAITING", v: bridge.pending, tone: bridge.pending > 0 ? "text-amber" : "text-fog" },
          ].map((s) => (
            <div key={s.k} className="rounded-md border border-line-soft bg-ink-850/60 px-2 py-1.5 text-center">
              <div className={`num font-mdata text-[15px] font-bold ${s.tone}`}>{s.v}</div>
              <div className="font-mdata text-[7px] tracking-[0.16em] text-dim">{s.k}</div>
            </div>
          ))}
        </div>

        {/* mapping */}
        <div className="rounded-md border border-line-soft bg-ink-850/60 px-3 py-2">
          <div className="flex items-center gap-2 pb-1 font-mdata text-[8px] tracking-[0.2em] text-dim">
            <Waypoints size={10} className="text-viol" /> SYMBOL MAP — DESK → BROKER
          </div>
          <div className="grid grid-cols-2 gap-x-4">
            {bridge.mapping.map((m) => (
              <div key={m.ours} className="flex items-center justify-between border-b border-line-soft/50 py-1 last:border-0">
                <span className="font-mdata text-[9.5px] text-fog">{m.ours}</span>
                <span className="font-mdata text-[9.5px] text-cyanx">{m.broker}</span>
              </div>
            ))}
          </div>
          <p className="mt-1.5 font-mdata text-[8px] leading-relaxed text-dim">
            FP Markets trades WTI as USOUSD and natural gas as NGAS. If a symbol is greyed out in Market Watch, remove it from the EA input list.
          </p>
        </div>
      </div>
    </section>
  );
}
