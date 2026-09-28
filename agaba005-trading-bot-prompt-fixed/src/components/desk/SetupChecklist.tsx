"use client";

import { useState } from "react";
import {
  FlaskConical,
  Landmark,
  CheckCircle2,
  ClipboardList,
  ChevronDown,
} from "lucide-react";
import type { BridgeDto } from "@/lib/types";

const DEMO_STEPS = [
  {
    t: "Open a free FP Markets MT5 demo",
    d: "fpmarkets.com → Try a Free Demo → choose MetaTrader 5, USD, leverage you plan to use live (e.g. 1:100). You'll get a login number, password and a server such as FPMarkets-Demo by email and in the client portal.",
  },
  {
    t: "Install MT5 and log into the demo",
    d: "Download MT5 from the FP Markets portal or MetaQuotes, then File → Login to Trade Account with your demo credentials. Confirm the journal shows a successful connection.",
  },
  {
    t: "Make this app reachable from MT5",
    d: "The EA must POST to this app over HTTPS. Either keep this hosted URL, or deploy the app (Vercel/Railway/VPS with Postgres) and use your own domain. Set MT5_BRIDGE_KEY as an env var and use the same value as the EA's ApiKey.",
  },
  {
    t: "Whitelist the URL and allow algo trading",
    d: "In MT5: Tools → Options → Expert Advisors → tick 'Allow algorithmic trading' and 'Allow WebRequest for listed URL' → add this app's base URL (e.g. https://your-app.com). Without this the EA shows error 4060.",
  },
  {
    t: "Install and attach the bridge EA",
    d: "Download Agaba005Bridge.mq5 (button, left) → in MT5: File → Open Data Folder → MQL5/Experts/ → paste → open MetaEditor (F4), compile (F7) → drag the EA onto ONE chart → set ApiUrl + ApiKey inputs → Algo Trading button goes green → Experts log prints 'HB ok' on every poll.",
  },
  {
    t: "Flip the desk to MT5 LINKED",
    d: "With the terminal card showing CONNECTED, switch Execution Mode to MT5 LINKED. The engine now consumes your broker's real quotes (M1) and routes fills back here. Watch ROUTED → FILLED counters on the left and the order log in MT5.",
  },
  {
    t: "Run the demo gauntlet before live money",
    d: "Minimum 2 weeks / 50 trades: filled prices vs this dashboard, slippage on TP/SL, trail MODIFYs landing, no refused orders, win rate holding ≥75%, equity curve intact. Optional: set the EA input DryRun=true for the first 24h to verify the pipeline with zero orders.",
  },
];

const LIVE_STEPS = [
  {
    t: "Open the live account you actually want",
    d: "FP Markets Raw (tighter spreads, per-lot commission — best for this scalping profile) on MT5, same leverage as demo, funded with money you can fully afford to lose.",
  },
  {
    t: "Move the EA to the live terminal",
    d: "Same install, but set ApiKey to a NEW secret (set MT5_BRIDGE_KEY on the server to match). Keep the demo EA running in parallel if you want a paper control group.",
  },
  {
    t: "Start at minimum risk and scale by proof",
    d: "Set the desk risk preset to 1%. Let it prove itself for another 2+ weeks. Only scale toward 1.5–2% if live stats still hold ≥75% WR with clean execution.",
  },
  {
    t: "Run it 24/5 on a VPS near the broker",
    d: "FP Markets servers sit in Equinix NY4 — a New York VPS keeps heartbeat latency in single-digit ms and protects the link from your home power/internet. Check the bridge panel daily; LINK STALE is your early-warning siren.",
  },
  {
    t: "Know the kill-switches",
    d: "FLATTEN button closes everything at market · Pause stops new entries · Removing the EA / disabling Algo Trading freezes new orders while broker-side SL/TP keeps protecting existing tickets.",
  },
];

function StepList({ steps, tone }: { steps: { t: string; d: string }[]; tone: string }) {
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3">
          <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border font-mdata text-[9px] font-bold ${tone}`}>
            {i + 1}
          </span>
          <div className="min-w-0">
            <div className="font-disp text-[12.5px] font-semibold leading-snug text-bright">{s.t}</div>
            <p className="mt-0.5 font-mdata text-[10px] leading-relaxed text-dim">{s.d}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function SetupChecklist({ bridge }: { bridge: BridgeDto }) {
  const [tab, setTab] = useState<"demo" | "live">("demo");
  return (
    <section className="panel rise flex h-full min-h-0 flex-col" style={{ animationDelay: "440ms" }}>
      <header className="panel-head justify-between">
        <span className="flex items-center gap-2">
          <ClipboardList size={12} className="text-amber" />
          Go-live protocol · demo first, live by proof
        </span>
        <span className={`flex items-center gap-1.5 rounded-sm border px-1.5 py-[1px] font-mdata text-[9px] tracking-[0.14em] ${bridge.connected ? "border-phos/30 bg-phos/10 text-phos" : "border-line text-dim"}`}>
          <CheckCircle2 size={9} />
          {bridge.connected ? "LINK VERIFIED" : "LINK PENDING"}
        </span>
      </header>
      <div className="flex gap-1 border-b border-line-soft px-3 pt-2">
        {(
          [
            { id: "demo", label: "PHASE 1 — DEMO", icon: FlaskConical, cls: "text-cyanx border-cyanx" },
            { id: "live", label: "PHASE 2 — LIVE", icon: Landmark, cls: "text-phos border-phos" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 font-mdata text-[10px] tracking-[0.16em] transition-colors ${
              tab === t.id ? t.cls : "border-transparent text-dim hover:text-fog"
            }`}
          >
            <t.icon size={11} />
            {t.label}
          </button>
        ))}
        <ChevronDown size={11} className="ml-auto mt-2.5 text-dim" />
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "demo" ? (
          <StepList steps={DEMO_STEPS} tone="border-cyanx/40 bg-cyanx/10 text-cyanx" />
        ) : (
          <StepList steps={LIVE_STEPS} tone="border-phos/40 bg-phos/10 text-phos" />
        )}
        <p className="mt-4 rounded-md border border-amber/25 bg-amber/[0.05] p-3 font-mdata text-[9.5px] leading-relaxed text-amber/90">
          RISK NOTE — the +20% daily target and 75% win-rate floor are objectives the engine optimizes toward, not promises. Live fills differ from simulation through spreads, slippage and gaps. Never fund an account you cannot afford to lose, and let demo statistics — not confidence — unlock every size increase.
        </p>
      </div>
    </section>
  );
}
