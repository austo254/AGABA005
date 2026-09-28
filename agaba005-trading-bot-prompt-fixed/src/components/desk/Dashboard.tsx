"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/lib/types";
import TopBar from "./TopBar";
import MarketBoard from "./MarketBoard";
import DecisionFeed from "./DecisionFeed";
import PositionsPanel from "./PositionsPanel";
import StatsRail from "./StatsRail";
import EquityChart from "./EquityChart";
import SessionReports from "./SessionReports";
import HistoryTable from "./HistoryTable";
import BridgePanel from "./BridgePanel";
import SetupChecklist from "./SetupChecklist";

const BOOT_LINES = [
  "AGABA005 // kernel initializing…",
  "mounting market adapters — 13 instruments · 5 asset classes",
  "loading confluence matrix — trend · momentum · structure · liquidity",
  "syncing risk kernel — 1.5% per-trade cap · 1:2 RR floor · trail +1R",
  "connecting ledger… desk is live.",
];

function BootScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-950 p-6">
      <div className="w-full max-w-xl">
        <div className="font-disp text-2xl font-bold tracking-[0.22em] text-bright">
          AGABA<span className="text-phos">005</span>
        </div>
        <div className="mt-4 space-y-1.5 border-l border-line pl-4">
          {BOOT_LINES.map((l, i) => (
            <div key={i} className="boot-line font-mdata text-[11px] tracking-[0.08em] text-dim" style={{ animationDelay: `${i * 280}ms` }}>
              <span className="text-phos">▸</span> {l}
            </div>
          ))}
          <div className="boot-line mt-2 font-mdata text-[11px] text-phos" style={{ animationDelay: `${BOOT_LINES.length * 280}ms` }}>
            <span className="blink-dot">█</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [latency, setLatency] = useState(0);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pull = useCallback(async () => {
    const t0 = performance.now();
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const data = (await res.json()) as Snapshot & { ok: boolean };
      if (data.ok) {
        setSnap(data);
        setOffline(false);
      }
    } catch {
      setOffline(true);
    } finally {
      setLatency(Math.round(performance.now() - t0));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const loop = async () => {
      await pull();
      if (alive) timer.current = setTimeout(loop, 2400);
    };
    loop();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [pull]);

  const control = useCallback(
    async (action: string, value?: number | string) => {
      setBusy(true);
      try {
        await fetch("/api/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, value }),
        });
        await pull();
      } finally {
        setBusy(false);
      }
    },
    [pull],
  );

  if (!snap) return <BootScreen />;
  const s = snap.state;

  return (
    <div className="min-h-screen bg-ink-950 bg-[radial-gradient(90%_60%_at_50%_-10%,rgba(53,242,167,0.05),transparent)]">
      <div className="mx-auto flex max-w-[1780px] flex-col gap-3 p-3">
        <TopBar state={s} onControl={control} busy={busy} />

        {offline && (
          <div className="rounded-md border border-crim/30 bg-crim/10 px-3 py-2 font-mdata text-[10px] tracking-[0.16em] text-crim">
            FEED INTERRUPTED — retrying… engine state persists server-side.
          </div>
        )}

        {/* main grid */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
          <div className="xl:col-span-3 xl:h-[620px]">
            <div className="h-[420px] xl:h-full">
              <MarketBoard market={snap.market} threshold={s.threshold} />
            </div>
          </div>
          <div className="xl:col-span-5 xl:h-[620px]">
            <div className="h-[560px] xl:h-full">
              <DecisionFeed events={snap.events} />
            </div>
          </div>
          <div className="grid grid-rows-2 gap-3 xl:col-span-4 xl:h-[620px]">
            <PositionsPanel positions={snap.positions} />
            <StatsRail stats={snap.stats} threshold={s.threshold} />
          </div>
        </div>

        {/* analytics band */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <EquityChart curve={snap.curve} dayStart={s.dayStart} />
          </div>
          <div className="h-[260px] xl:col-span-4 xl:h-auto">
            <SessionReports reports={snap.reports} />
          </div>
        </div>

        {/* MT5 bridge band */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
          <div className="h-[560px] xl:col-span-5">
            <BridgePanel bridge={snap.bridge} onControl={control} busy={busy} />
          </div>
          <div className="h-[560px] xl:col-span-7">
            <SetupChecklist bridge={snap.bridge} />
          </div>
        </div>

        <HistoryTable history={snap.history} />

        <footer className="flex flex-wrap items-center justify-between gap-2 px-1 pb-3 pt-1 font-mdata text-[8px] tracking-[0.2em] text-dim">
          <span>
            AGABA005 · QUALITY OVER QUANTITY — fewer, high-conviction trades · trail winners, cut losers · simulated market feed, no live capital at risk
          </span>
          <span className="num">
            ENGINE LATENCY {latency}ms · POLL 2.4s · SIM M5 COMPRESSION
          </span>
        </footer>
      </div>
    </div>
  );
}
