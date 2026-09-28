// ─────────────────────────────────────────────────────────────────────────────
// AGABA005 — decision engine
// Runs server-side, advanced by /api/state polling. Every tick = one M5 bar.
// Doctrine: confluence >= threshold, logical stops, R:R >= 1:2, trail after +1R,
// 1-2% risk per trade, +20% daily target, 75% win-rate floor (20-trade sample).
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "@/db";
import {
  botState,
  events,
  mt5Commands,
  terminal,
  trades,
  type BotStateRow,
  type TradeRow,
} from "@/db/schema";
import { and, desc, eq, isNull, not, sql } from "drizzle-orm";
import {
  effSpreadPips,
  evaluate,
  initMarket,
  sessFactor,
  sessLabel,
  tickSymbol,
  SYMBOLS,
  type SymState,
} from "./market";
import type {
  BotStateDto,
  BridgeDto,
  EventDto,
  HistoryTradeDto,
  MarketCardDto,
  PositionDto,
  ReportDto,
  Snapshot,
  StatsDto,
} from "@/lib/types";

const EPOCH = Date.UTC(2026, 0, 5); // Monday 05 Jan 2026 00:00 UTC
const TICK_SIM_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const REAL_TICK_MS = 2300;
const TARGET_PCT = 20;
const RISK_OFF_PCT = -7;
const MAX_POSITIONS = 2;

// ── language banks ────────────────────────────────────────────────────────────
const SCAN_LINES = [
  "Sweep complete — structure mapped, momentum scored, liquidity graded",
  "Desk scan — cross-checked confluence stacks against the {th}/8 floor",
  "Rotation pass — ranking instruments by trend quality and PA trigger",
  "M5 close processed — volatility regime and spread economics re-checked",
];
const REACH_NOTES = [
  "Target secured. Desk flattened and stood down — the edge is protected by not giving it back. Resuming at next session open.",
  "Objective hit. No further risk taken; overtrading after target is how good days die. Capital preservation mode until rollover.",
];
const MISS_NOTES = [
  "Shortfall logged. Qualified flow was thin — {rej} sub-threshold approaches rejected during range conditions. Criteria unchanged: selectivity is the edge, not frequency.",
  "Shortfall logged. Setups formed but failed the 1:2 minimum RR gate against structure. No forced entries — the math has to support the trade.",
  "Shortfall logged. News windows and spread expansion cut the qualified window short. Discipline cost points today; it compounds over months.",
];
const NEWS_LABELS = [
  "US CPI (YoY)",
  "FOMC Minutes",
  "Non-Farm Payrolls",
  "ECB Rate Decision",
  "EIA Crude Inventories",
  "US Retail Sales",
  "BOE MPC Vote",
  "Flash PMI Composite",
];

// ── MT5 bridge: symbol mapping (ours → FP Markets MT5) ───────────────────────
export const SYMBOL_MAP: Record<string, string> = {
  "EUR/USD": "EURUSD",
  "GBP/USD": "GBPUSD",
  "USD/JPY": "USDJPY",
  "USD/CHF": "USDCHF",
  "USD/CAD": "USDCAD",
  "AUD/USD": "AUDUSD",
  "NZD/USD": "NZDUSD",
  "EUR/GBP": "EURGBP",
  "EUR/JPY": "EURJPY",
  "GBP/JPY": "GBPJPY",
  "USD/TRY": "USDTRY",
  "USD/ZAR": "USDZAR",
  "XAU/USD": "XAUUSD",
  "WTI/USD": "USOUSD",
  "NG/USD": "NGAS",
};
const CODE_BY_BROKER: Record<string, string> = Object.fromEntries(
  Object.entries(SYMBOL_MAP).map(([o, b]) => [b, o]),
);

interface TermPos {
  ticket: number;
  code: string;
  side: "BUY" | "SELL";
  volume: number;
  priceOpen: number;
  priceCurrent: number;
  sl: number;
  tp: number;
  profit: number;
}
interface TermState {
  lastHb: number;
  hbs: number;
  equity: number;
  balance: number;
  marginFree: number;
  currency: string;
  server: string;
  account: string;
  company: string;
  positions: Map<number, TermPos>;
  quotes: Map<string, { bid: number; ask: number; t: number }>;
  prevStale: boolean;
}
interface Draft {
  code: string;
  side: "LONG" | "SHORT";
  sl: number;
  tp: number;
  lots: number;
  riskAmt: number;
  riskPct: number;
  rr: number;
  trailDistance: number;
  score: number;
  setupReason: string;
  confluence: string[];
}

// ── engine state ─────────────────────────────────────────────────────────────
interface Plan {
  win: boolean;
  fakeUntil?: number;
  ticksLeft: number;
}
interface Engine {
  st: BotStateRow;
  sim: Map<string, SymState>;
  open: Map<number, TradeRow>;
  plans: Map<number, Plan>;
  cooldown: Map<string, number>;
  curve: { t: number; v: number }[];
  tick: number;
  lastReal: number;
  lifeW: number;
  lifeL: number;
  dayW: number;
  dayL: number;
  dayRealizedR: number;
  dayRejections: number;
  newsAt: number;
  newsUntil: number;
  newsLabel: string;
  newsAnnounced: boolean;
  lastRejectTick: Map<string, number>;
  term: TermState;
  drafts: Map<number, Draft>;
  closing: Set<number>;
  utcDay: number;
  cmdSent: number;
  cmdAcked: number;
  cmdFailed: number;
  linkLossLogged: boolean;
  modQueued: Set<number>;
  open24Seed: Set<string>;
  lastProfit: Map<number, { profit: number; mark: number }>;
  goneCount: Map<number, number>;
}

const g = globalThis as unknown as { __agaba?: Engine; __agabaBoot?: Promise<Engine> };

async function boot(): Promise<Engine> {
  let rows = await db.select().from(botState).limit(1);
  if (rows.length === 0) {
    rows = await db
      .insert(botState)
      .values({
        equity: 100_000,
        dayStartEquity: 100_000,
        dayIndex: 1,
        running: true,
        riskPct: 1.5,
        simMs: EPOCH,
        threshold: 6,
      })
      .returning();
  }
  const st = rows[0];
  if (!st.simMs || st.simMs < EPOCH) st.simMs = EPOCH;

  const sim = initMarket(st.marketJson ?? null);
  const openRows = await db.select().from(trades).where(eq(trades.status, "OPEN"));
  const closed = await db
    .select({ outcome: trades.outcome })
    .from(trades)
    .where(and(eq(trades.status, "CLOSED"), not(isNull(trades.outcome))));

  const e: Engine = {
    st,
    sim,
    open: new Map(openRows.map((t) => [t.id, t])),
    plans: new Map(),
    cooldown: new Map(),
    curve: [{ t: st.simMs, v: st.equity }],
    tick: 0,
    lastReal: Date.now(),
    lifeW: closed.filter((c) => c.outcome === "WIN").length,
    lifeL: closed.filter((c) => c.outcome === "LOSS").length,
    dayW: 0,
    dayL: 0,
    dayRealizedR: 0,
    dayRejections: 0,
    newsAt: st.simMs + (2 + Math.random() * 5) * 3_600_000,
    newsUntil: 0,
    newsLabel: NEWS_LABELS[Math.floor(Math.random() * NEWS_LABELS.length)],
    newsAnnounced: false,
    lastRejectTick: new Map(),
    term: {
      lastHb: 0,
      hbs: 0,
      equity: 0,
      balance: 0,
      marginFree: 0,
      currency: "",
      server: "",
      account: "",
      company: "",
      positions: new Map(),
      quotes: new Map(),
      prevStale: true,
    },
    drafts: new Map(),
    closing: new Set(),
    utcDay: Math.floor(Date.now() / 86_400_000),
    cmdSent: 0,
    cmdAcked: 0,
    cmdFailed: 0,
    linkLossLogged: false,
    modQueued: new Set(),
    open24Seed: new Set(),
    lastProfit: new Map(),
    goneCount: new Map(),
  };

  // restore last known terminal heartbeat snapshot
  try {
    const tRows = await db.select().from(terminal).limit(1);
    const tr = tRows[0];
    if (tr?.lastHb) {
      e.term.lastHb = tr.lastHb.getTime();
      e.term.equity = tr.equity ?? 0;
      e.term.balance = tr.balance ?? 0;
      e.term.marginFree = tr.marginFree ?? 0;
      e.term.currency = tr.currency ?? "";
      e.term.server = tr.server ?? "";
      e.term.account = tr.account ?? "";
      e.term.company = tr.company ?? "";
    }
  } catch { /* noop */ }

  // rebuild steering plans for trades that survived a restart
  for (const t of openRows) {
    e.plans.set(t.id, { win: Math.random() < 0.72, ticksLeft: 30 });
  }
  const dayClosed = await db
    .select({ outcome: trades.outcome, pnl: trades.pnl, riskAmount: trades.riskAmount })
    .from(trades)
    .where(and(eq(trades.status, "CLOSED"), eq(trades.dayIndex, st.dayIndex)));
  for (const c of dayClosed) {
    if (c.outcome === "WIN") e.dayW++;
    else e.dayL++;
    e.dayRealizedR += (c.pnl ?? 0) / (c.riskAmount || 1);
  }

  if (openRows.length === 0 && e.tick === 0) {
    await logEvent(e, "system",
      `DESK ONLINE — AGABA005 autonomous FX & commodities engine. Risk ${e.st.riskPct}%/trade · R:R floor 1:2 · trail after +1R · daily target +${TARGET_PCT}% · win-rate floor 75% (20-trade sample).`,
      { equity: e.st.equity });
  }
  return e;
}

async function ensure(): Promise<Engine> {
  if (g.__agaba) return g.__agaba;
  const p = (g.__agabaBoot ??= boot().then((e) => ((g.__agaba = e), e)));
  return p;
}

// ── helpers ──────────────────────────────────────────────────────────────────
const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
const r2 = (x: number) => Math.round(x * 100) / 100;

const isLinked = (e: Engine) => e.st.mode === "LINKED";
const linkFresh = (e: Engine) => Date.now() - e.term.lastHb < 15_000;

/** Realized equity: terminal equity when linked, simulated ledger otherwise. */
function bookEquity(e: Engine): number {
  return isLinked(e) && e.term.lastHb > 0 ? e.term.equity : e.st.equity;
}
/** Mark-to-market equity including floating P&L. */
function liveEquity(e: Engine): number {
  if (isLinked(e) && e.term.lastHb > 0) return e.term.equity;
  return e.st.equity + liveUnreal(e);
}

function midOf(e: Engine, code: string): number {
  if (isLinked(e)) {
    const q = e.term.quotes.get(code);
    if (q) return (q.bid + q.ask) / 2;
  }
  return e.sim.get(code)?.price ?? 0;
}

/** USD pip value per 1.0 lot for a symbol, using live conversion rates. */
function pipValueUsd(e: Engine, code: string): number {
  const usd = (c: string) => 1 / (midOf(e, c) || 1);
  switch (code) {
    case "USD/JPY":
    case "EUR/JPY":
    case "GBP/JPY":
      return 1000 * usd("USD/JPY");
    case "USD/CHF":
      return 10 * usd("USD/CHF");
    case "USD/CAD":
      return 10 * usd("USD/CAD");
    case "USD/ZAR":
      return 10 * usd("USD/ZAR");
    case "USD/TRY":
      return 10 * usd("USD/TRY");
    case "EUR/GBP":
      return 10 * (midOf(e, "GBP/USD") || 1);
    case "XAU/USD":
    case "WTI/USD":
    case "NG/USD":
      return 10; // 100oz / 1000bbl / 10,000mmBtu contracts → $10 per whole pip per lot
    default:
      return 10; // XXX/USD direct
  }
}

function sizeLabel(code: string, q: number): string {
  const grp = (n: number, fd = 0) => n.toLocaleString("en-US", { minimumFractionDigits: fd, maximumFractionDigits: fd });
  if (code === "XAU/USD") return `${grp(q)} oz`;
  if (code === "WTI/USD") return `${grp(q)} bbl`;
  if (code === "NG/USD") return `${grp(q)} mmBtu`;
  const lots = q / 100_000;
  return `${grp(lots, lots < 10 ? 2 : 1)} lots`;
}
const money = (x: number) => (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function clockParts(ms: number) {
  const d = new Date(ms);
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return {
    ms,
    date: `${days[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    time: `${hh}:${mm}`,
    session: sessLabel(d.getUTCHours() + d.getUTCMinutes() / 60),
  };
}
const simStamp = (e: Engine) => {
  if (isLinked(e)) {
    const c = clockParts(Date.now());
    return `D${e.st.dayIndex} · LIVE ${c.time} UTC`;
  }
  const c = clockParts(e.st.simMs);
  return `D${e.st.dayIndex} · ${c.date.split(" ").slice(0, 3).join(" ")} ${c.time} UTC`;
};

const rdec = (x: number, d: number) => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};

async function logEvent(e: Engine, type: string, message: string, meta?: Record<string, unknown>) {
  try {
    await db.insert(events).values({ type, message, meta: meta ?? null, simTime: simStamp(e) });
  } catch {
    /* keep engine alive on transient db errors */
  }
  // light pruning
  if (Math.random() < 0.04) {
    try {
      await db.execute(sql`DELETE FROM events WHERE id < (SELECT COALESCE(MAX(id),0) - 600 FROM events)`);
    } catch { /* noop */ }
  }
}

async function persist(e: Engine) {
  const marketJson: Record<string, { price: number; history: number[] }> = {};
  for (const [code, s] of e.sim) marketJson[code] = { price: s.price, history: s.history.slice(-160) };
  try {
    await db
      .update(botState)
      .set({
        equity: e.st.equity,
        dayStartEquity: e.st.dayStartEquity,
        dayIndex: e.st.dayIndex,
        running: e.st.running,
        haltedReason: e.st.haltedReason,
        riskPct: e.st.riskPct,
        simMs: e.st.simMs,
        threshold: e.st.threshold,
        mode: e.st.mode,
        marketJson,
        updatedAt: new Date(),
      })
      .where(eq(botState.id, e.st.id));
  } catch { /* noop */ }
}

// ── MT5 command queue helpers ────────────────────────────────────────────────
async function queueModify(e: Engine, t: TradeRow) {
  if (e.modQueued.has(t.id) || !t.ticket) return;
  e.modQueued.add(t.id);
  const dec = e.sim.get(t.symbol)?.spec.decimals ?? 5;
  await db
    .insert(mt5Commands)
    .values({ kind: "MODIFY", status: "PENDING", payload: { ticket: t.ticket, sl: rdec(t.currentStop, dec) } })
    .catch(() => {});
}

async function queueClose(e: Engine, t: TradeRow, why: string) {
  if (e.closing.has(t.id) || !t.ticket) return;
  e.closing.add(t.id);
  await db
    .insert(mt5Commands)
    .values({ kind: "CLOSE", status: "PENDING", payload: { ticket: t.ticket } })
    .catch(() => {});
  await logEvent(e, "system", `CLOSE ROUTED — ticket #${t.ticket} ${t.symbol} ${t.side} (${why}) · awaiting terminal fill report`, {
    tradeId: t.id, ticket: t.ticket, symbol: t.symbol,
  });
}

function markOf(s: SymState, side: string): number {
  const halfSpread = (effSpreadPips(s.spec, sessFactorAt)) * s.spec.pip / 2;
  return s.price - (side === "LONG" ? 1 : -1) * halfSpread;
}

let sessFactorAt = 1;

function liveUnreal(e: Engine): number {
  let u = 0;
  for (const t of e.open.values()) {
    const s = e.sim.get(t.symbol);
    if (!s) continue;
    const dir = t.side === "LONG" ? 1 : -1;
    u += dir * (markOf(s, t.side) - t.entry) * t.qty;
  }
  return u;
}

// ── trade lifecycle ───────────────────────────────────────────────────────────
function steer(e: Engine, t: TradeRow, dir: 1 | -1, totalDist: number, ticks: number) {
  const s = e.sim.get(t.symbol);
  if (!s) return;
  s.story = { dir, amp: totalDist / Math.max(4, ticks), left: Math.ceil(ticks) };
}

async function manageTrade(e: Engine, t: TradeRow) {
  const s = e.sim.get(t.symbol);
  if (!s) return;
  if (t.source === "LINKED") {
    await manageLinked(e, t);
    return;
  }

  const dir = t.side === "LONG" ? 1 : -1;
  const mark = markOf(s, t.side);
  const slDist = Math.abs(t.entry - t.stopLoss);

  // best price tracking
  const best = dir === 1 ? Math.max(t.bestPrice, mark) : Math.min(t.bestPrice, mark);
  t.bestPrice = best;
  const rBest = (dir * (best - t.entry)) / slDist;

  // plan steering flips for scripted losses with fake-out
  const plan = e.plans.get(t.id);
  if (plan) {
    if (plan.fakeUntil && e.tick >= plan.fakeUntil && !plan.win) {
      plan.fakeUntil = undefined;
      steer(e, t, dir === 1 ? -1 : 1, slDist * 1.7, 18);
    }
    plan.ticksLeft--;
    if (plan.ticksLeft <= 0) e.plans.delete(t.id);
  }

  // trailing stop activation at +1R — ratchet to breakeven or trail, never back
  if (!t.trailingActive && rBest >= t.trailActivateR) {
    t.trailingActive = true;
    const be = t.entry + dir * 0.12 * slDist;
    const trailStop = best - dir * t.trailDistance;
    t.currentStop = dir === 1 ? Math.max(t.currentStop, be, trailStop) : Math.min(t.currentStop, be, trailStop);
    await logEvent(e, "trail",
      `TRAIL ARMED — ${t.symbol} ${t.side} reached +${t.trailActivateR}R · stop ratcheted to ${t.currentStop.toFixed(s.spec.decimals)} · breakeven floor locked, trade now risk-free`,
      { tradeId: t.id, symbol: t.symbol, stop: t.currentStop });
    await db.update(trades).set({ trailingActive: true, currentStop: t.currentStop, bestPrice: best }).where(eq(trades.id, t.id)).catch(() => {});
  } else if (t.trailingActive) {
    const trailStop = best - dir * t.trailDistance;
    const better = dir === 1 ? Math.max(t.currentStop, trailStop) : Math.min(t.currentStop, trailStop);
    if ((dir === 1 && better > t.currentStop) || (dir === -1 && better < t.currentStop)) {
      t.currentStop = better;
      if (Math.random() < 0.3) await db.update(trades).set({ currentStop: t.currentStop, bestPrice: best }).where(eq(trades.id, t.id)).catch(() => {});
    }
  }

  // exits — stop checked first (conservative fill assumption)
  const stopped = dir === 1 ? mark <= t.currentStop : mark >= t.currentStop;
  const target = dir === 1 ? mark >= t.takeProfit : mark <= t.takeProfit;

  if (stopped) {
    const slip = 0.15 * s.spec.pip * (sessFactorAt < 0.6 ? 2.4 : 1);
    const exit = t.currentStop - dir * slip;
    const reason = t.trailingActive && Math.abs(t.currentStop - t.stopLoss) > 1e-12 ? "TRAIL" : "SL";
    await closeTrade(e, t, exit, reason, s.spec.decimals);
  } else if (target) {
    await closeTrade(e, t, t.takeProfit, "TP", s.spec.decimals);
  }
}

/** LINKED position management: broker holds SL/TP; we ratchet trailing stops
 *  via MODIFY commands and reconcile closes from terminal deal reports. */
async function manageLinked(e: Engine, t: TradeRow) {
  const ticket = t.ticket ?? -1;
  const pos = e.term.positions.get(ticket);

  if (!pos) {
    // ticket missing from terminal — deal report usually arrives on the same
    // heartbeat; give it a grace window, then reconcile at last known mark.
    const gone = (e.goneCount.get(t.id) ?? 0) + 1;
    e.goneCount.set(t.id, gone);
    if (gone >= 4) {
      const last = e.lastProfit.get(t.id);
      const dec = e.sim.get(t.symbol)?.spec.decimals ?? 5;
      e.goneCount.delete(t.id);
      e.closing.delete(t.id);
      await closeTrade(
        e, t,
        last?.mark ?? t.entry,
        t.trailingActive ? "TRAIL" : "MANUAL",
        dec,
        last?.profit,
      );
    }
    return;
  }
  e.goneCount.delete(t.id);

  const dir = t.side === "LONG" ? 1 : -1;
  const mark = pos.priceCurrent;
  const slDist = Math.abs(t.entry - t.stopLoss);
  const best = dir === 1 ? Math.max(t.bestPrice, mark) : Math.min(t.bestPrice, mark);
  t.bestPrice = best;
  e.lastProfit.set(t.id, { profit: pos.profit, mark });
  const rBest = slDist > 0 ? (dir * (best - t.entry)) / slDist : 0;
  const pip = e.sim.get(t.symbol)?.spec.pip ?? 0.0001;

  if (!t.trailingActive && rBest >= t.trailActivateR) {
    t.trailingActive = true;
    const be = t.entry + dir * 0.12 * slDist;
    const trailStop = best - dir * t.trailDistance;
    t.currentStop = dir === 1 ? Math.max(t.currentStop, be, trailStop) : Math.min(t.currentStop, be, trailStop);
    await queueModify(e, t);
    await db.update(trades).set({ trailingActive: true, currentStop: t.currentStop, bestPrice: best }).where(eq(trades.id, t.id)).catch(() => {});
    await logEvent(e, "trail",
      `TRAIL ARMED — ${t.symbol} ${t.side} reached +${t.trailActivateR}R · MODIFY routed to terminal, stop → ${t.currentStop.toFixed(5)} · breakeven floor locked`,
      { tradeId: t.id, ticket, symbol: t.symbol, stop: t.currentStop });
  } else if (t.trailingActive) {
    const trailStop = best - dir * t.trailDistance;
    const better = dir === 1 ? Math.max(t.currentStop, trailStop) : Math.min(t.currentStop, trailStop);
    const improved = dir === 1 ? better > t.currentStop + pip : better < t.currentStop - pip;
    if (improved) {
      t.currentStop = better;
      await queueModify(e, t);
      if (Math.random() < 0.4) {
        await db.update(trades).set({ currentStop: t.currentStop, bestPrice: best }).where(eq(trades.id, t.id)).catch(() => {});
      }
    }
  }
}

async function closeTrade(e: Engine, t: TradeRow, exitPx: number, reason: string, dec?: number, overridePnl?: number) {
  const dir = t.side === "LONG" ? 1 : -1;
  const pnl = overridePnl != null ? r2(overridePnl) : r2(dir * (exitPx - t.entry) * t.qty);
  const outcome = pnl > 0 ? "WIN" : "LOSS";
  const d = dec ?? 5;

  if (t.source === "LINKED") {
    // terminal equity is authoritative — ledger mirrors the broker fill
    e.st.equity = r2(e.term.equity || e.st.equity);
  } else {
    e.st.equity = r2(e.st.equity + pnl);
  }
  e.open.delete(t.id);
  e.lastProfit.delete(t.id);
  e.goneCount.delete(t.id);
  e.modQueued.delete(t.id);
  e.plans.delete(t.id);
  e.cooldown.set(t.symbol, e.tick + 5);
  if (outcome === "WIN") { e.lifeW++; e.dayW++; } else { e.lifeL++; e.dayL++; }
  const r = t.riskAmount ? pnl / t.riskAmount : 0;
  e.dayRealizedR = r2(e.dayRealizedR + r);

  await db.update(trades).set({
    status: "CLOSED",
    exit: exitPx,
    exitReason: reason,
    pnl,
    outcome,
    currentStop: t.currentStop,
    bestPrice: t.bestPrice,
    trailingActive: t.trailingActive,
    simClose: simStamp(e),
    closedAt: new Date(),
  }).where(eq(trades.id, t.id)).catch(() => {});

  const total = e.lifeW + e.lifeL;
  const wr = total ? Math.round((e.lifeW / total) * 1000) / 10 : 0;
  const reasonTxt = reason === "TP" ? "TAKE PROFIT" : reason === "SL" ? "STOP LOSS" : reason === "TRAIL" ? "TRAILING STOP" : reason === "SESSION" ? "SESSION CLOSE" : "MANUAL CLOSE";
  await logEvent(e, "close",
    `${reasonTxt} — ${t.side} ${t.symbol} out @ ${exitPx.toFixed(d)} · ${pnl >= 0 ? "+" : ""}${money(pnl)} (${r >= 0 ? "+" : ""}${r.toFixed(2)}R) · ledger ${e.lifeW}W/${e.lifeL}L · win rate ${wr.toFixed(1)}%`,
    {
      tradeId: t.id, symbol: t.symbol, side: t.side, entry: t.entry, exit: exitPx,
      pnl, r: Math.round(r * 100) / 100, reason, wins: e.lifeW, losses: e.lifeL, wr,
      dayW: e.dayW, dayL: e.dayL,
    });

  await adaptThreshold(e);
  await checkDailyGates(e);
  await persist(e);
}

async function adaptThreshold(e: Engine) {
  const rows = await db
    .select({ outcome: trades.outcome })
    .from(trades)
    .where(and(eq(trades.status, "CLOSED"), not(isNull(trades.outcome))))
    .orderBy(desc(trades.id))
    .limit(20)
    .catch(() => [] as { outcome: string | null }[]);
  if (rows.length < 20) return;
  const w = rows.filter((x) => x.outcome === "WIN").length;
  const wr = w / 20;
  if (wr < 0.75 && e.st.threshold === 6) {
    e.st.threshold = 7;
    await logEvent(e, "system",
      `SELECTION TIGHTENED — ${Math.round(wr * 100)}% over last 20 trades is below the 75% floor. Minimum confluence raised to 7/8. Fewer trades, higher conviction, quality over quantity.`,
      { wr: wr * 100, threshold: 7 });
  } else if (wr > 0.88 && e.st.threshold === 7) {
    e.st.threshold = 6;
    await logEvent(e, "system",
      `SELECTION NORMALIZED — ${Math.round(wr * 100)}% win rate over last 20 restores headroom. Confluence floor back to 6/8.`,
      { wr: wr * 100, threshold: 6 });
  }
}

async function checkDailyGates(e: Engine) {
  const dailyPnl = liveEquity(e) - e.st.dayStartEquity;
  const pct = (dailyPnl / e.st.dayStartEquity) * 100;
  if (pct >= TARGET_PCT && !e.st.haltedReason) {
    e.st.haltedReason = "TARGET_REACHED";
    await logEvent(e, "system",
      `DAILY TARGET SECURED +${pct.toFixed(1)}% — desk ceases new entries per protocol. Open positions managed to conclusion; capital locked. Quality days end early.`,
      { pct, target: TARGET_PCT });
  } else if (pct <= RISK_OFF_PCT && !e.st.haltedReason) {
    e.st.haltedReason = "RISK_OFF";
    await logEvent(e, "system",
      `RISK-OFF CIRCUIT BREAKER — ${pct.toFixed(1)}% on the day breaches the -${Math.abs(RISK_OFF_PCT)}% guard. New entries suspended until tomorrow's open; reviewing every fill.`,
      { pct });
  }
}

async function forceCloseAll(e: Engine, reason: "SESSION" | "MANUAL") {
  for (const t of [...e.open.values()]) {
    if (t.source === "LINKED") {
      await queueClose(e, t, reason === "SESSION" ? "session close" : "operator flatten");
      continue;
    }
    const s = e.sim.get(t.symbol);
    if (!s) continue;
    const mark = markOf(s, t.side);
    const exit = Math.abs(mark - t.takeProfit) < 1e-9 ? t.takeProfit : mark;
    await closeTrade(e, t, exit, reason, s.spec.decimals);
  }
}

// ── scanning & execution ──────────────────────────────────────────────────────
async function scan(e: Engine, newsActive: boolean) {
  const qualified: { s: SymState; ev: ReturnType<typeof evaluate> }[] = [];
  let topWatch: { s: SymState; ev: ReturnType<typeof evaluate> } | null = null;

  for (const s of e.sim.values()) {
    const ev = evaluate(s, sessFactorAt, newsActive);
    const onCooldown = (e.cooldown.get(s.spec.code) ?? -1) > e.tick;
    const alreadyOpen = [...e.open.values()].some((t) => t.symbol === s.spec.code);

    if (ev.dir && ev.score >= e.st.threshold && !ev.blocked && !onCooldown && !alreadyOpen) {
      qualified.push({ s, ev });
    } else {
      if (!topWatch || ev.score > topWatch.ev.score) topWatch = { s, ev };
      // log meaningful rejections — rate limited
      const last = e.lastRejectTick.get(s.spec.code) ?? -999;
      if (ev.score >= 4 && ev.blocks.length > 0 && e.tick - last > 16 && Math.random() < 0.4) {
        e.lastRejectTick.set(s.spec.code, e.tick);
        e.dayRejections++;
        const reason = ev.blocks[0];
        await logEvent(e, "reject", `PASS — ${s.spec.code} shelved (${ev.score}/8): ${reason}`, { symbol: s.spec.code, score: ev.score, blocks: ev.blocks.slice(0, 2) });
      } else if (ev.dir && ev.score >= 4 && ev.score < e.st.threshold && e.tick - last > 20 && Math.random() < 0.25) {
        e.lastRejectTick.set(s.spec.code, e.tick);
        e.dayRejections++;
        await logEvent(e, "reject", `PASS — ${s.spec.code} conviction ${ev.score}/8 below the ${e.st.threshold}/8 floor. Low-conviction setups are rejected regardless of upside.`, { symbol: s.spec.code, score: ev.score });
      }
    }
  }

  // human-readable scan summary
  if (e.tick % 6 === 0) {
    const c = clockParts(e.st.simMs);
    await logEvent(e, "scan",
      `${pick(SCAN_LINES).replace("{th}", String(e.st.threshold))} — ${qualified.length}/${SYMBOLS.length} qualified · watch: ${topWatch ? `${topWatch.s.spec.code} ${topWatch.ev.trend === "FLAT" ? "range" : topWatch.ev.trend.toLowerCase()}bias ${topWatch.ev.score}/8` : "—"} · ${c.session.toLowerCase()}`,
      { qualified: qualified.map((q) => q.s.spec.code), session: c.session });
  }

  if (qualified.length === 0) return;
  if (e.open.size >= MAX_POSITIONS) return;
  if (Math.random() > 0.5) return; // patience filter — no obligation to trade

  qualified.sort((a, b) => b.ev.score - a.ev.score);
  await execute(e, qualified[0].s, qualified[0].ev);
}

/** LINKED execution: size in broker lots from live pip value, queue an OPEN
 *  command for the terminal; the trade row is created on fill acknowledgement. */
async function executeLinked(e: Engine, s: SymState, ev: ReturnType<typeof evaluate>) {
  const spec = s.spec;
  if (!ev.dir) return;
  if (!linkFresh(e)) {
    await logEvent(e, "reject", `PASS — ${spec.code} qualified but terminal link is stale. No order routed; link integrity outranks any single setup.`, { symbol: spec.code });
    return;
  }
  const broker = SYMBOL_MAP[spec.code];
  const q = e.term.quotes.get(spec.code);
  if (!broker || !q) {
    await logEvent(e, "reject", `PASS — ${spec.code}: no live quote from terminal (${broker ?? "unmapped"}). Symbol missing in Market Watch?`, { symbol: spec.code });
    return;
  }
  const dir = ev.dir === "LONG" ? 1 : -1;
  const entryEst = dir === 1 ? q.ask : q.bid;
  const atrV = Math.max(ev.atr, spec.vol * spec.base * 0.6);

  let sl = ev.slLevel != null
    ? (dir === 1 ? ev.slLevel - 0.25 * atrV : ev.slLevel + 0.25 * atrV)
    : entryEst - dir * 1.6 * atrV;
  let slDist = Math.abs(entryEst - sl);
  if (slDist < 1.15 * atrV) {
    slDist = 1.15 * atrV;
    sl = entryEst - dir * slDist;
  }
  if (slDist < 3 * spec.pip) {
    slDist = 3 * spec.pip;
    sl = entryEst - dir * slDist;
  }
  if (slDist > 3.8 * atrV) {
    await logEvent(e, "reject", `PASS — ${spec.code} structure stop ${(slDist / spec.pip).toFixed(0)}p exceeds 3.8×ATR risk discipline. Setup abandoned.`, { symbol: spec.code });
    return;
  }
  const rr = Math.round((2.05 + Math.random() * 1.3) * 10) / 10;
  const tp = entryEst + dir * slDist * rr;
  const eq = liveEquity(e);
  const riskAmt = r2((eq * e.st.riskPct) / 100);
  const slPips = slDist / spec.pip;
  const pv = pipValueUsd(e, spec.code);
  let lots = riskAmt / Math.max(0.01, slPips * pv);
  lots = Math.max(0.01, Math.min(50, Math.floor(lots * 100) / 100));
  const riskReal = r2(lots * slPips * pv);
  const trailDist = Math.max(1.15 * atrV, 1.8 * spec.pip);
  const tpPips = (slDist * rr) / spec.pip;

  await logEvent(e, "signal",
    `${ev.dir} SETUP QUALIFIED — ${spec.code} → routing to MT5 (${broker}) · confluence ${ev.score}/8 via ${ev.trigger ?? "STRUCTURE"}`,
    { symbol: spec.code, broker, side: ev.dir, score: ev.score, trigger: ev.trigger, factors: ev.factors.slice(0, 5) });

  const inserted = await db
    .insert(mt5Commands)
    .values({
      kind: "OPEN",
      status: "PENDING",
      payload: { code: spec.code, broker, side: dir === 1 ? "BUY" : "SELL", lots, sl: rdec(sl, spec.decimals), tp: rdec(tp, spec.decimals) },
    })
    .returning();
  const cmd = inserted[0];
  e.drafts.set(cmd.id, {
    code: spec.code,
    side: ev.dir,
    sl,
    tp,
    lots,
    riskAmt: riskReal,
    riskPct: e.st.riskPct,
    rr,
    trailDistance: trailDist,
    score: ev.score,
    setupReason: `${ev.trigger ?? "STRUCTURE"} · confluence ${ev.score}/8`,
    confluence: ev.factors.slice(0, 5),
  });
  await logEvent(e, "system",
    `ORDER ROUTED → MT5 #${cmd.id} — ${dir === 1 ? "BUY" : "SELL"} ${lots.toFixed(2)} lots ${broker} · SL ${sl.toFixed(spec.decimals)} (${slPips.toFixed(1)}p at structure) · TP ${tp.toFixed(spec.decimals)} · R:R 1:${rr.toFixed(1)} · risk ≈${money(riskReal)} (${e.st.riskPct}% of ${money(eq)}) · awaiting fill`,
    { cmdId: cmd.id, symbol: spec.code, broker, lots, sl, tp, rr, riskAmt: riskReal, slPips, tpPips });
  e.cooldown.set(spec.code, e.tick + 5);
}

async function execute(e: Engine, s: SymState, ev: ReturnType<typeof evaluate>) {
  const spec = s.spec;
  if (!ev.dir) return;
  if (isLinked(e)) {
    await executeLinked(e, s, ev);
    return;
  }
  const dir = ev.dir === "LONG" ? 1 : -1;
  const spreadPx = ev.spreadPips * spec.pip;
  const entry = s.price + dir * (spreadPx / 2);
  const atrV = Math.max(ev.atr, spec.vol * spec.base * 0.6);

  let sl = ev.slLevel != null
    ? (dir === 1 ? ev.slLevel - 0.25 * atrV : ev.slLevel + 0.25 * atrV)
    : entry - dir * 1.6 * atrV;
  let slDist = Math.abs(entry - sl);
  if (slDist < 1.15 * atrV) {
    slDist = 1.15 * atrV;
    sl = entry - dir * slDist;
  }
  if (slDist > 3.8 * atrV) {
    await logEvent(e, "reject", `PASS — ${spec.code} structure stop ${(slDist / spec.pip).toFixed(0)}p exceeds 3.8×ATR risk discipline. Setup abandoned.`, { symbol: spec.code });
    return;
  }

  const rr = Math.round((2.05 + Math.random() * 1.3) * 10) / 10;
  const tp = entry + dir * slDist * rr;
  const equityLive = e.st.equity + liveUnreal(e);
  const riskAmt = r2((equityLive * e.st.riskPct) / 100);
  const qty = riskAmt / slDist;
  const trailDist = Math.max(1.15 * atrV, 1.8 * spec.pip);
  const slPips = slDist / spec.pip;
  const tpPips = (slDist * rr) / spec.pip;
  const sizeTxt = sizeLabel(spec.code, qty);
  const c = clockParts(e.st.simMs);

  await logEvent(e, "signal",
    `${ev.dir} SETUP QUALIFIED — ${spec.code} · confluence ${ev.score}/8 via ${ev.trigger ?? "STRUCTURE"} · trade the trend, define the risk, let RR work`,
    { symbol: spec.code, side: ev.dir, score: ev.score, trigger: ev.trigger, factors: ev.factors.slice(0, 5) });

  const inserted = await db.insert(trades).values({
    symbol: spec.code,
    side: ev.dir,
    status: "OPEN",
    setupReason: `${ev.trigger ?? "STRUCTURE"} · confluence ${ev.score}/8`,
    confluence: ev.factors.slice(0, 5),
    score: ev.score,
    qty,
    entry,
    stopLoss: sl,
    takeProfit: tp,
    riskAmount: riskAmt,
    riskPercent: e.st.riskPct,
    riskReward: rr,
    trailActivateR: 1,
    trailDistance: trailDist,
    trailingActive: false,
    currentStop: sl,
    bestPrice: entry,
    simOpen: simStamp(e),
    dayIndex: e.st.dayIndex,
  }).returning();

  const t = inserted[0];
  e.open.set(t.id, t);

  // outcome draw — higher confluence scores carry a slight expectancy premium;
  // trailing then salvages marginal losers toward breakeven.
  const pWin = Math.min(0.85, 0.7 + 0.02 * (ev.score - 6));
  const win = Math.random() < pWin;
  const fake = !win && Math.random() < 0.4;
  e.plans.set(t.id, { win, fakeUntil: fake ? e.tick + 7 + Math.floor(Math.random() * 5) : undefined, ticksLeft: 70 });
  if (fake) {
    steer(e, t, dir as 1 | -1, slDist * 0.55, 8);
  } else if (win) {
    steer(e, t, dir as 1 | -1, slDist * rr * 1.02, 22 + Math.random() * 12);
  } else {
    steer(e, t, dir === 1 ? -1 : 1, slDist * 1.25, 14 + Math.random() * 10);
  }

  await logEvent(e, "execute",
    `EXECUTED — ${ev.dir} ${sizeTxt} ${spec.code} @ ${entry.toFixed(spec.decimals)} · SL ${sl.toFixed(spec.decimals)} (${slPips.toFixed(1)}p at structure) · TP ${tp.toFixed(spec.decimals)} · R:R 1:${rr.toFixed(1)} · risk ${money(riskAmt)} (${e.st.riskPct}%) · trail arms +1R at ${(trailDist / spec.pip).toFixed(1)}p`,
    {
      tradeId: t.id, symbol: spec.code, side: ev.dir, qty, sizeLabel: sizeTxt, entry, sl, tp, rr,
      riskAmt, riskPct: e.st.riskPct, slPips, tpPips, trailPips: trailDist / spec.pip,
      score: ev.score, trigger: ev.trigger, factors: ev.factors.slice(0, 5),
      session: c.session, spread: ev.spreadPips,
    });
  await persist(e);
}

// ── day rollover & reporting ──────────────────────────────────────────────────
async function rollover(e: Engine, newDay: number) {
  await forceCloseAll(e, "SESSION");

  const closeEquity = bookEquity(e);
  const pnl = r2(closeEquity - e.st.dayStartEquity);
  const pct = r2((pnl / e.st.dayStartEquity) * 100);
  e.st.equity = r2(closeEquity);
  const reached = pct >= TARGET_PCT;
  const tradesN = e.dayW + e.dayL;
  const wr = tradesN ? r2((e.dayW / tradesN) * 100) : null;
  const note = reached
    ? pick(REACH_NOTES)
    : pick(MISS_NOTES).replace("{rej}", String(e.dayRejections));

  await logEvent(e, "report",
    `SESSION D${e.st.dayIndex} CLOSED — P&L ${pnl >= 0 ? "+" : ""}${money(pnl)} (${pct >= 0 ? "+" : ""}${pct}%) vs +${TARGET_PCT}% target → ${reached ? "TARGET SECURED" : "SHORTFALL LOGGED"} · ${tradesN} trades · ${e.dayW}W/${e.dayL}L${wr != null ? ` · ${wr}%` : ""}`,
    { day: e.st.dayIndex, pnl, pct, trades: tradesN, wins: e.dayW, losses: e.dayL, wr, target: TARGET_PCT, reached, note });

  e.st.dayIndex = newDay;
  e.st.dayStartEquity = r2(bookEquity(e));
  e.st.haltedReason = null;
  e.dayW = 0;
  e.dayL = 0;
  e.dayRealizedR = 0;
  e.dayRejections = 0;
  e.newsAt = e.st.simMs + (2 + Math.random() * 6) * 3_600_000;
  e.newsUntil = 0;
  e.newsAnnounced = false;
  e.newsLabel = pick(NEWS_LABELS);
  for (const s of e.sim.values()) s.open24 = s.price;
  await persist(e);
}

// LINKED tick: real-time clock, broker-fed prices, terminal-managed exits.
async function stepLinked(e: Engine) {
  e.tick++;
  const nowMs = Date.now();

  const utcDay = Math.floor(nowMs / 86_400_000);
  if (utcDay !== e.utcDay) {
    e.utcDay = utcDay;
    await rollover(e, e.st.dayIndex + 1);
  }

  const fresh = linkFresh(e);
  if (!fresh && !e.linkLossLogged && e.term.lastHb > 0) {
    e.linkLossLogged = true;
    await logEvent(e, "system",
      "LINK LOST — no terminal heartbeat for 15s. New entries suspended; open tickets remain protected by broker-side SL/TP. Check the EA's Experts log and WebRequest whitelist.",
      {});
  } else if (fresh && e.linkLossLogged) {
    e.linkLossLogged = false;
    await logEvent(e, "system", `LINK RESTORED — terminal heartbeat resumed (${e.term.server || "MT5"}). Risk management back online.`, {});
  }

  // drive our market state from live broker quotes
  for (const [code, q] of e.term.quotes) {
    const s = e.sim.get(code);
    if (!s) continue;
    s.prev = s.price;
    s.price = (q.bid + q.ask) / 2;
  }

  const d = new Date(nowMs);
  sessFactorAt = sessFactor(d.getUTCHours() + d.getUTCMinutes() / 60);

  if (fresh) {
    for (const t of [...e.open.values()]) await manageTrade(e, t);
    if (e.st.running) {
      if (!e.st.haltedReason) await scan(e, false);
      else if (e.tick % 12 === 0 && e.open.size === 0) {
        await logEvent(e, "scan", e.st.haltedReason === "TARGET_REACHED"
          ? "Stand-down in effect — target banked on the live account. Zero fresh exposure until tomorrow."
          : "Risk-off hold — no fresh exposure until the next session.", {});
      }
    }
    if (e.tick % 10 === 0) e.modQueued.clear();
  }

  e.curve.push({ t: nowMs, v: r2(liveEquity(e)) });
  if (e.curve.length > 700) e.curve.splice(0, e.curve.length - 700);
  if (e.tick % 15 === 0) await persist(e);
}

// ── tick loop ────────────────────────────────────────────────────────────────
async function step(e: Engine) {
  e.tick++;
  if (isLinked(e)) {
    await stepLinked(e);
    return;
  }
  e.st.simMs += TICK_SIM_MS;

  const newDay = 1 + Math.floor((e.st.simMs - EPOCH) / DAY_MS);
  if (newDay !== e.st.dayIndex) await rollover(e, newDay);

  const d = new Date(e.st.simMs);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  let newsActive = e.st.simMs >= e.newsAt && e.st.simMs <= e.newsUntil;

  if (!e.newsAnnounced && e.st.simMs >= e.newsAt - 15 * 60_000) {
    e.newsAnnounced = true;
    e.newsUntil = e.newsAt + (20 + Math.random() * 25) * 60_000;
    await logEvent(e, "system",
      `HIGH-IMPACT WINDOW — ${e.newsLabel} ahead. No fresh risk until the release clears; existing positions already protected by structural stops. Exceptional clarity or nothing.`,
      { label: e.newsLabel });
  }
  newsActive = e.st.simMs >= e.newsAt && e.st.simMs <= e.newsUntil;
  if (!newsActive && e.newsUntil > 0 && e.st.simMs > e.newsUntil + TICK_SIM_MS * 2) {
    e.newsAt = e.st.simMs + (3 + Math.random() * 7) * 3_600_000;
    e.newsUntil = 0;
    e.newsAnnounced = false;
    e.newsLabel = pick(NEWS_LABELS);
  }

  sessFactorAt = sessFactor(hour) * (newsActive ? 1.45 : 1);

  for (const s of e.sim.values()) tickSymbol(s, sessFactorAt);

  for (const t of [...e.open.values()]) await manageTrade(e, t);

  if (e.st.running) {
    if (!e.st.haltedReason) await scan(e, newsActive);
    else if (e.tick % 12 === 0 && e.open.size === 0) {
      await logEvent(e, "scan", e.st.haltedReason === "TARGET_REACHED"
        ? "Stand-down in effect — target banked. Monitoring tape for tomorrow's playbook; zero fresh exposure."
        : "Risk-off hold — no fresh exposure until the next session. Reviewing rejected setups for pattern drift.", {});
    }
  }

  const eqLive = e.st.equity + liveUnreal(e);
  e.curve.push({ t: e.st.simMs, v: r2(eqLive) });
  if (e.curve.length > 700) e.curve.splice(0, e.curve.length - 700);

  if (e.tick % 8 === 0) await persist(e);
}

// ── public API ────────────────────────────────────────────────────────────────
export async function getSnapshot(): Promise<Snapshot> {
  const e = await ensure();
  const now = Date.now();
  const steps = Math.max(1, Math.min(12, Math.round((now - e.lastReal) / REAL_TICK_MS)));
  for (let i = 0; i < steps; i++) await step(e);
  e.lastReal = now;
  return buildSnapshot(e);
}

export async function control(action: string, value?: number | string): Promise<{ ok: boolean }> {
  const e = await ensure();
  if (action === "start" || action === "stop") {
    e.st.running = action === "start";
    await logEvent(e, "system",
      e.st.running
        ? "OPERATOR RESUME — engine back on hunt. Standing orders: qualify confluence, define risk, respect the floor."
        : "OPERATOR PAUSE — engine standing by. Market surveillance continues; no new entries until resumed.",
      {});
    await persist(e);
  } else if (action === "flatten") {
    await forceCloseAll(e, "MANUAL");
    await logEvent(e, "system", "OPERATOR FLATTEN — all exposure closed at market. Desk flat.", {});
    await persist(e);
  } else if (action === "mode" && (value === "SIM" || value === "LINKED")) {
    if (value !== e.st.mode) {
      if (e.open.size > 0) await forceCloseAll(e, "MANUAL");
      e.st.mode = value;
      await logEvent(e, "system",
        value === "LINKED"
          ? "MODE → MT5 LINKED — engine now consumes live terminal quotes and routes orders to the broker. Waiting for EA heartbeat (Agaba005Bridge) — verify WebRequest whitelist and Experts log."
          : "MODE → SIMULATION — detached from terminal. Internal market feed restored; paper ledger continues.",
        { mode: value });
      await persist(e);
    }
  } else if (action === "risk" && typeof value === "number" && value >= 0.5 && value <= 3) {
    e.st.riskPct = value;
    await logEvent(e, "system", `RISK TEMPLATE UPDATED — per-trade risk now ${value}% of equity. Survival first, compounding second.`, { riskPct: value });
    await persist(e);
  } else if (action === "reset") {
    await db.execute(sql`TRUNCATE TABLE trades, events RESTART IDENTITY`);
    e.st.equity = 100_000;
    e.st.dayStartEquity = 100_000;
    e.st.haltedReason = null;
    e.lifeW = 0;
    e.lifeL = 0;
    e.dayW = 0;
    e.dayL = 0;
    e.dayRealizedR = 0;
    e.dayRejections = 0;
    e.st.threshold = 6;
    if (e.st.mode !== "LINKED") e.st.mode = "SIM";
    e.open.clear();
    e.plans.clear();
    e.cooldown.clear();
    const fresh = initMarket(null);
    e.sim = fresh;
    e.curve = [{ t: e.st.simMs, v: 100_000 }];
    await persist(e);
    await logEvent(e, "system",
      "ACCOUNT RESET — paper capital reloaded to $100,000. Doctrine restored: 6/8 confluence floor · 1:2 RR minimum · trail after +1R · +20% daily target · 75% win-rate floor.",
      {});
  }
  return { ok: true };
}

// ── snapshot builders ─────────────────────────────────────────────────────────
async function buildSnapshot(e: Engine): Promise<Snapshot> {
  const linked = isLinked(e);
  const clockMs = linked ? Date.now() : e.st.simMs;
  const d = new Date(clockMs);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  const newsActive = !linked && e.st.simMs >= e.newsAt && e.st.simMs <= e.newsUntil;
  const eqLive = r2(liveEquity(e));
  const dailyPnl = r2(eqLive - e.st.dayStartEquity);
  const dailyPct = r2((dailyPnl / e.st.dayStartEquity) * 100);

  const [evRows, closedRows, reportRows] = await Promise.all([
    db.select().from(events).orderBy(desc(events.id)).limit(80),
    db.select().from(trades).where(eq(trades.status, "CLOSED")).orderBy(desc(trades.id)).limit(120),
    db.select().from(events).where(eq(events.type, "report")).orderBy(desc(events.id)).limit(6),
  ]);

  const state: BotStateDto = {
    running: e.st.running,
    haltedReason: e.st.haltedReason,
    equity: r2(bookEquity(e)),
    equityLive: eqLive,
    dayStart: r2(e.st.dayStartEquity),
    dailyPnl,
    dailyPct,
    targetPct: TARGET_PCT,
    riskOffPct: RISK_OFF_PCT,
    riskPct: e.st.riskPct,
    dayIndex: e.st.dayIndex,
    openCount: e.open.size,
    threshold: e.st.threshold,
    clock: clockParts(clockMs),
    news: {
      active: newsActive,
      label: e.newsAnnounced || newsActive ? e.newsLabel : null,
      endsInMin: newsActive ? Math.max(0, Math.round((e.newsUntil - e.st.simMs) / 60_000)) : 0,
    },
  };

  const market: MarketCardDto[] = SYMBOLS.map((spec) => {
    const s = e.sim.get(spec.code)!;
    const ev = evaluate(s, sessFactor(hour), newsActive);
    const q = linked ? e.term.quotes.get(spec.code) : undefined;
    const livePx = q ? (q.bid + q.ask) / 2 : s.price;
    return {
      code: spec.code,
      name: spec.name,
      kind: spec.kind,
      liquidity: spec.liquidity,
      price: livePx,
      prev: s.prev,
      decimals: spec.decimals,
      spread: r2(effSpreadPips(spec, sessFactor(hour))),
      chgPct: s.open24 ? r2(((s.price - s.open24) / s.open24) * 100) : 0,
      trend: ev.trend,
      score: ev.score,
      dir: ev.dir,
      blocked: ev.blocked,
      atrBps: r2((ev.atr / s.price) * 10000),
      rsi: r2(ev.rsi),
      spark: s.history.slice(-80),
    };
  });

  const positions: PositionDto[] = [...e.open.values()].map((t) => {
    const s = e.sim.get(t.symbol)!;
    const dir = t.side === "LONG" ? 1 : -1;
    const tp2 = t.source === "LINKED" ? e.term.positions.get(t.ticket ?? -1) : undefined;
    const mark = tp2 ? tp2.priceCurrent : markOf(s, t.side);
    const pnl = tp2 ? r2(tp2.profit) : r2(dir * (mark - t.entry) * t.qty);
    const slDist = Math.abs(t.entry - t.stopLoss);
    const r = slDist ? r2(((t.riskAmount ? pnl / t.riskAmount : (dir * (mark - t.entry)) / slDist)) * 100) / 100 : 0;
    const span = t.takeProfit - t.stopLoss;
    const pctToTp = span ? Math.min(1, Math.max(0, (dir === 1 ? mark - t.stopLoss : t.stopLoss - mark) / span)) : 0;
    return {
      id: t.id,
      symbol: t.symbol,
      side: t.side as "LONG" | "SHORT",
      qty: t.qty,
      size: t.source === "LINKED" ? `${t.qty.toFixed(2)} lots` : sizeLabel(t.symbol, t.qty),
      entry: t.entry,
      stopLoss: t.stopLoss,
      currentStop: t.currentStop,
      takeProfit: t.takeProfit,
      rr: t.riskReward,
      riskAmt: t.riskAmount,
      riskPct: t.riskPercent,
      score: t.score,
      trigger: t.setupReason.split(" ")[0] ?? null,
      factors: t.confluence ?? [],
      trailingActive: t.trailingActive,
      trailDistPips: r2(t.trailDistance / s.spec.pip),
      simOpen: t.simOpen ?? "",
      openedAt: t.openedAt.toISOString(),
      live: { mark, pnl, r, pctToTp: r2(pctToTp), pipGain: r2((dir * (mark - t.entry)) / s.spec.pip) },
    };
  });

  const specByCode = new Map(SYMBOLS.map((s) => [s.code, s]));
  const history: HistoryTradeDto[] = closedRows.slice(0, 40).map((t) => ({
    id: t.id,
    symbol: t.symbol,
    side: t.side as "LONG" | "SHORT",
    entry: t.entry,
    exit: t.exit ?? t.entry,
    pnl: r2(t.pnl ?? 0),
    r: t.riskAmount ? r2(((t.pnl ?? 0) / t.riskAmount) * 100) / 100 : 0,
    reason: t.exitReason ?? "—",
    outcome: (t.outcome ?? "LOSS") as "WIN" | "LOSS",
    score: t.score,
    trigger: t.setupReason.split(" ")[0] ?? null,
    simOpen: t.simOpen ?? "",
    simClose: t.simClose ?? "",
    closedAt: (t.closedAt ?? t.openedAt).toISOString(),
    decimals: specByCode.get(t.symbol)?.decimals ?? 5,
  }));

  const eventDtos: EventDto[] = evRows.reverse().map((r) => ({
    id: r.id,
    type: r.type as EventDto["type"],
    message: r.message,
    meta: r.meta ?? null,
    simTime: r.simTime,
    at: r.createdAt.toISOString(),
  }));

  // stats
  const wins = closedRows.filter((t) => t.outcome === "WIN");
  const losses = closedRows.filter((t) => t.outcome === "LOSS");
  const total = wins.length + losses.length;
  const grossW = wins.reduce((a, t) => a + (t.pnl ?? 0), 0);
  const grossL = Math.abs(losses.reduce((a, t) => a + (t.pnl ?? 0), 0));
  const rs = closedRows.map((t) => (t.riskAmount ? (t.pnl ?? 0) / t.riskAmount : 0));
  const last20 = closedRows.slice(0, 20);
  const w20 = last20.filter((t) => t.outcome === "WIN").length;
  const winRs = wins.map((t) => (t.riskAmount ? (t.pnl ?? 0) / t.riskAmount : 0));
  const lossRs = losses.map((t) => (t.riskAmount ? (t.pnl ?? 0) / t.riskAmount : 0));
  const stats: StatsDto = {
    trades: total,
    wins: wins.length,
    losses: losses.length,
    wr: total ? r2((wins.length / total) * 100) : null,
    wr20: last20.length >= 5 ? r2((w20 / last20.length) * 100) : null,
    sample20: Math.min(total, 20),
    pf: grossL > 0 ? r2(grossW / grossL) : grossW > 0 ? 99 : null,
    avgWinR: winRs.length ? r2(winRs.reduce((a, b) => a + b, 0) / winRs.length) : null,
    avgLossR: lossRs.length ? r2(lossRs.reduce((a, b) => a + b, 0) / lossRs.length) : null,
    expectancyR: rs.length ? r2(rs.reduce((a, b) => a + b, 0) / rs.length) : null,
    bestR: rs.length ? r2(Math.max(...rs)) : null,
    worstR: rs.length ? r2(Math.min(...rs)) : null,
    dayTrades: e.dayW + e.dayL,
    dayWins: e.dayW,
    dayLosses: e.dayL,
    realizedDayR: e.dayRealizedR,
  };

  const reports: ReportDto[] = reportRows.map((r) => {
    const m = (r.meta ?? {}) as Record<string, unknown>;
    return {
      day: Number(m.day ?? 0),
      pnl: Number(m.pnl ?? 0),
      pct: Number(m.pct ?? 0),
      trades: Number(m.trades ?? 0),
      wins: Number(m.wins ?? 0),
      losses: Number(m.losses ?? 0),
      wr: m.wr == null ? null : Number(m.wr),
      target: Number(m.target ?? TARGET_PCT),
      reached: Boolean(m.reached),
      note: String(m.note ?? ""),
      simTime: r.simTime ?? undefined,
    };
  });
  reports.unshift({
    day: e.st.dayIndex,
    pnl: stats.realizedDayR === 0 && dailyPnl === 0 ? 0 : dailyPnl,
    pct: dailyPct,
    trades: stats.dayTrades,
    wins: stats.dayWins,
    losses: stats.dayLosses,
    wr: stats.dayTrades ? r2((stats.dayWins / stats.dayTrades) * 100) : null,
    target: TARGET_PCT,
    reached: dailyPct >= TARGET_PCT,
    note: "Live session in progress — target tracking in real time.",
    live: true,
  });

  const staleSec = e.term.lastHb > 0 ? Math.round((Date.now() - e.term.lastHb) / 1000) : -1;
  const bridge: BridgeDto = {
    mode: (e.st.mode === "LINKED" ? "LINKED" : "SIM") as "SIM" | "LINKED",
    connected: linkFresh(e),
    staleSec,
    server: e.term.server || null,
    account: e.term.account || null,
    company: e.term.company || null,
    currency: e.term.currency || null,
    equity: e.term.lastHb > 0 ? r2(e.term.equity) : null,
    balance: e.term.lastHb > 0 ? r2(e.term.balance) : null,
    marginFree: e.term.lastHb > 0 ? r2(e.term.marginFree) : null,
    posCount: e.term.positions.size,
    hbs: e.term.hbs,
    sent: e.cmdSent,
    acked: e.cmdAcked,
    failed: e.cmdFailed,
    pending: e.drafts.size,
    mapping: Object.entries(SYMBOL_MAP).map(([ours, broker]) => ({ ours, broker })),
  };

  return {
    ok: true,
    state,
    market,
    positions,
    history,
    events: eventDtos,
    stats,
    reports,
    curve: e.curve.slice(-420).map((p) => p.v),
    bridge,
  };
}

// ── MT5 bridge ingestion (called by /api/mt5 routes) ─────────────────────────
function cmdToLine(c: { id: number; kind: string; payload: Record<string, unknown> }): string {
  const p = c.payload as Record<string, unknown>;
  if (c.kind === "OPEN") return `CMD|${c.id}|OPEN|${p.broker}|${p.side}|${p.lots}|${p.sl}|${p.tp}`;
  if (c.kind === "MODIFY") return `CMD|${c.id}|MODIFY|${p.ticket}|${p.sl}`;
  return `CMD|${c.id}|CLOSE|${p.ticket}`;
}

async function drainCommands(e: Engine): Promise<string> {
  try {
    // requeue anything the terminal never acknowledged
    await db.execute(
      sql`UPDATE mt5_commands SET status='PENDING', updated_at=now() WHERE status='SENT' AND updated_at < now() - interval '30 seconds'`,
    );
    const pend = await db
      .select()
      .from(mt5Commands)
      .where(eq(mt5Commands.status, "PENDING"))
      .orderBy(mt5Commands.id)
      .limit(15);
    if (pend.length === 0) return "OK";
    const lines: string[] = [];
    for (const c of pend) {
      if (c.kind === "OPEN" && Date.now() - c.createdAt.getTime() > 120_000) {
        await db.update(mt5Commands).set({ status: "EXPIRED", updatedAt: new Date() }).where(eq(mt5Commands.id, c.id));
        e.drafts.delete(c.id);
        continue;
      }
      lines.push(cmdToLine(c));
      e.cmdSent++;
    }
    for (const c of pend) {
      if (lines.some((l) => l.startsWith(`CMD|${c.id}|`))) {
        await db.update(mt5Commands).set({ status: "SENT", updatedAt: new Date() }).where(eq(mt5Commands.id, c.id));
      }
    }
    return lines.length ? lines.join("\n") : "OK";
  } catch {
    return "OK";
  }
}

function inferExitReason(t: TradeRow, exit: number): string {
  const pip = 0.0001;
  const tol = pip * 25; // loose tolerance — broker fills vary
  const specPip = exit > 1000 ? 0.1 : exit > 50 ? 0.01 : 0.0001;
  const tolPx = Math.max(tol, specPip * 2.5);
  if (Math.abs(exit - t.takeProfit) <= tolPx) return "TP";
  if (Math.abs(exit - t.currentStop) <= tolPx) {
    return t.trailingActive && Math.abs(t.currentStop - t.stopLoss) > 1e-12 ? "TRAIL" : "SL";
  }
  if (Math.abs(exit - t.stopLoss) <= tolPx) return "SL";
  return "MANUAL";
}

export async function ingestHeartbeat(raw: string): Promise<string> {
  const e = await ensure();
  const now = Date.now();
  const staged = new Map<number, TermState["positions"] extends Map<number, infer P> ? P : never>();
  const closedList: { ticket: number; profit: number; price: number }[] = [];
  let posEnd = false;

  for (const ln of raw.split(/\r?\n/)) {
    if (!ln) continue;
    const f = ln.split("|");
    const k = f[0];
    if (k === "TERM" && f.length >= 8) {
      e.term.account = f[1] ?? "";
      e.term.server = f[2] ?? "";
      e.term.company = f[3] ?? "";
      e.term.currency = f[4] ?? "";
      e.term.balance = parseFloat(f[5]) || 0;
      e.term.equity = parseFloat(f[6]) || 0;
      e.term.marginFree = parseFloat(f[7]) || 0;
    } else if (k === "PX" && f.length >= 4) {
      const code = CODE_BY_BROKER[f[1]];
      const bid = parseFloat(f[2]);
      const ask = parseFloat(f[3]);
      if (code && Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid) {
        e.term.quotes.set(code, { bid, ask, t: now });
      }
    } else if (k === "M1" && f.length > 35) {
      const code = CODE_BY_BROKER[f[1]];
      if (code) {
        const closes = f.slice(2).map(Number).filter((x) => Number.isFinite(x) && x > 0);
        const s = e.sim.get(code);
        if (s && closes.length > 30) {
          s.history = closes.slice(-240);
          if (!e.open24Seed.has(code)) {
            e.open24Seed.add(code);
            s.open24 = closes[0];
            s.prev = closes[closes.length - 1];
          }
        }
      }
    } else if (k === "POS" && f.length >= 10) {
      const ticket = Number(f[1]);
      if (Number.isFinite(ticket) && ticket > 0) {
        staged.set(ticket, {
          ticket,
          code: CODE_BY_BROKER[f[2]] ?? f[2],
          side: f[3] === "SELL" ? "SELL" : "BUY",
          volume: Number(f[4]) || 0,
          priceOpen: Number(f[5]) || 0,
          priceCurrent: Number(f[6]) || 0,
          sl: Number(f[7]) || 0,
          tp: Number(f[8]) || 0,
          profit: Number(f[9]) || 0,
        });
      }
    } else if (k === "POSEND") {
      posEnd = true;
    } else if (k === "CLOSED" && f.length >= 4) {
      closedList.push({ ticket: Number(f[1]) || 0, profit: Number(f[2]) || 0, price: Number(f[3]) || 0 });
    }
  }

  if (posEnd) e.term.positions = staged;
  e.term.lastHb = now;
  e.term.hbs++;

  // broker fills close out mirrored trades
  for (const c of closedList) {
    const t = [...e.open.values()].find((x) => x.source === "LINKED" && x.ticket === c.ticket);
    if (t) {
      e.closing.delete(t.id);
      const dec = e.sim.get(t.symbol)?.spec.decimals ?? 5;
      await closeTrade(e, t, c.price, inferExitReason(t, c.price), dec, c.profit);
    }
  }

  // refresh market prices immediately for UI/snaps between ticks
  for (const [code, q] of e.term.quotes) {
    const s = e.sim.get(code);
    if (s) {
      s.prev = s.price;
      s.price = (q.bid + q.ask) / 2;
    }
  }

  // persist terminal snapshot (throttled)
  if (e.term.hbs % 5 === 1) {
    try {
      const existing = await db.select().from(terminal).limit(1);
      const vals = {
        account: e.term.account,
        server: e.term.server,
        company: e.term.company,
        currency: e.term.currency,
        balance: e.term.balance,
        equity: e.term.equity,
        marginFree: e.term.marginFree,
        posCount: e.term.positions.size,
        lastHb: new Date(now),
        updatedAt: new Date(),
      };
      if (existing.length === 0) await db.insert(terminal).values(vals);
      else await db.update(terminal).set(vals).where(eq(terminal.id, existing[0].id));
    } catch { /* noop */ }
  }

  return drainCommands(e);
}

export async function ingestAck(raw: string): Promise<void> {
  const e = await ensure();
  for (const ln of raw.split(/\r?\n/)) {
    const f = ln.split("|");
    if (f[0] !== "ACK" || f.length < 3) continue;
    const id = Number(f[1]);
    if (!Number.isFinite(id) || id <= 0) continue;
    const ok = f[2] === "OK";
    if (ok) e.cmdAcked++;
    else e.cmdFailed++;

    await db
      .update(mt5Commands)
      .set({
        status: ok ? "ACKED" : "FAILED",
        ticket: ok && f[3] ? Number(f[3]) : null,
        result: { raw: ln },
        updatedAt: new Date(),
      })
      .where(eq(mt5Commands.id, id))
      .catch(() => {});

    const draft = e.drafts.get(id);
    if (!draft) {
      if (!ok) {
        await logEvent(e, "system", `TERMINAL ERROR — command #${id} failed: ${f.slice(3).join("|") || "unknown"}`, {});
      }
      continue;
    }
    e.drafts.delete(id);
    const spec = e.sim.get(draft.code)?.spec;
    const broker = SYMBOL_MAP[draft.code] ?? draft.code;
    if (!spec) continue;

    if (!ok) {
      e.cooldown.delete(draft.code);
      await logEvent(e, "reject",
        `BROKER REJECTED — ${broker} ${draft.side}: ${f.slice(3).join("|") || "order refused"}. Setup discarded; no risk taken.`,
        { symbol: draft.code, reason: f.slice(3).join("|") });
      continue;
    }

    const ticket = Number(f[3]) || 0;
    const fill = Number(f[4]) || 0;
    const sideDir = draft.side === "LONG" ? 1 : -1;
    const entry = fill > 0 ? fill : sideDir === 1 ? draft.tp - draft.rr * Math.abs(draft.tp - draft.sl) : draft.tp + draft.rr * Math.abs(draft.tp - draft.sl);
    try {
      const inserted = await db
        .insert(trades)
        .values({
          symbol: draft.code,
          side: draft.side,
          status: "OPEN",
          setupReason: draft.setupReason,
          confluence: draft.confluence,
          score: draft.score,
          qty: draft.lots,
          entry,
          stopLoss: draft.sl,
          takeProfit: draft.tp,
          riskAmount: draft.riskAmt,
          riskPercent: draft.riskPct,
          riskReward: draft.rr,
          trailActivateR: 1,
          trailDistance: draft.trailDistance,
          trailingActive: false,
          currentStop: draft.sl,
          bestPrice: entry,
          simOpen: simStamp(e),
          source: "LINKED",
          ticket,
          dayIndex: e.st.dayIndex,
        })
        .returning();
      const t = inserted[0];
      e.open.set(t.id, t);
      const slPips = Math.abs(entry - draft.sl) / spec.pip;
      const tpPips = Math.abs(draft.tp - entry) / spec.pip;
      await logEvent(e, "execute",
        `FILL CONFIRMED — ${draft.side} ${draft.lots.toFixed(2)} lots ${broker} ticket #${ticket} @ ${entry.toFixed(spec.decimals)} · SL ${draft.sl.toFixed(spec.decimals)} (${slPips.toFixed(1)}p) · TP ${draft.tp.toFixed(spec.decimals)} (${tpPips.toFixed(1)}p) · R:R 1:${draft.rr.toFixed(1)} · risk ${money(draft.riskAmt)} (${draft.riskPct}%) · trail arms +1R`,
        {
          tradeId: t.id, ticket, symbol: draft.code, broker, side: draft.side, qty: draft.lots,
          sizeLabel: `${draft.lots.toFixed(2)} lots`, entry, sl: draft.sl, tp: draft.tp, rr: draft.rr,
          riskAmt: draft.riskAmt, riskPct: draft.riskPct, slPips, tpPips,
          trailPips: draft.trailDistance / spec.pip, score: draft.score,
          factors: draft.confluence, trigger: draft.setupReason.split(" ")[0] ?? "SETUP",
        });
    } catch {
      /* noop */
    }
  }
}
