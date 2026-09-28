// Shared DTO types — safe to import from both server and client code.

export interface ClockDto {
  ms: number;
  date: string; // "MON 05 JAN 2026"
  time: string; // "14:35"
  session: string;
}

export interface NewsDto {
  active: boolean;
  label: string | null;
  endsInMin: number;
}

export interface BotStateDto {
  running: boolean;
  haltedReason: string | null;
  equity: number;
  equityLive: number;
  dayStart: number;
  dailyPnl: number;
  dailyPct: number;
  targetPct: number;
  riskOffPct: number;
  riskPct: number;
  dayIndex: number;
  openCount: number;
  threshold: number;
  clock: ClockDto;
  news: NewsDto;
}

export interface MarketCardDto {
  code: string;
  name: string;
  kind: string;
  liquidity: string;
  price: number;
  prev: number;
  decimals: number;
  spread: number;
  chgPct: number;
  trend: "UP" | "DOWN" | "FLAT";
  score: number;
  dir: "LONG" | "SHORT" | null;
  blocked: boolean;
  atrBps: number;
  rsi: number;
  spark: number[];
}

export interface LiveDto {
  mark: number;
  pnl: number;
  r: number;
  pctToTp: number; // 0..1 progress from SL -> TP
  pipGain: number;
}

export interface PositionDto {
  id: number;
  symbol: string;
  side: "LONG" | "SHORT";
  qty: number;
  size: string;
  entry: number;
  stopLoss: number;
  currentStop: number;
  takeProfit: number;
  rr: number;
  riskAmt: number;
  riskPct: number;
  score: number;
  trigger: string | null;
  factors: string[];
  trailingActive: boolean;
  trailDistPips: number;
  simOpen: string;
  openedAt: string;
  live: LiveDto;
}

export interface HistoryTradeDto {
  id: number;
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  exit: number;
  pnl: number;
  r: number;
  reason: string;
  outcome: "WIN" | "LOSS";
  score: number;
  trigger: string | null;
  simOpen: string;
  simClose: string;
  closedAt: string;
  decimals: number;
}

export interface EventDto {
  id: number;
  type: "scan" | "signal" | "execute" | "reject" | "close" | "trail" | "report" | "system";
  message: string;
  meta: Record<string, unknown> | null;
  simTime: string | null;
  at: string;
}

export interface StatsDto {
  trades: number;
  wins: number;
  losses: number;
  wr: number | null;
  wr20: number | null;
  sample20: number;
  pf: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  expectancyR: number | null;
  bestR: number | null;
  worstR: number | null;
  dayTrades: number;
  dayWins: number;
  dayLosses: number;
  realizedDayR: number;
}

export interface BridgeDto {
  mode: "SIM" | "LINKED";
  connected: boolean;
  staleSec: number;
  server: string | null;
  account: string | null;
  company: string | null;
  currency: string | null;
  equity: number | null;
  balance: number | null;
  marginFree: number | null;
  posCount: number;
  hbs: number;
  sent: number;
  acked: number;
  failed: number;
  pending: number;
  mapping: { ours: string; broker: string }[];
}

export interface ReportDto {
  day: number;
  pnl: number;
  pct: number;
  trades: number;
  wins: number;
  losses: number;
  wr: number | null;
  target: number;
  reached: boolean;
  note: string;
  live?: boolean;
  simTime?: string;
}

export interface Snapshot {
  ok: boolean;
  state: BotStateDto;
  market: MarketCardDto[];
  positions: PositionDto[];
  history: HistoryTradeDto[];
  events: EventDto[];
  stats: StatsDto;
  reports: ReportDto[];
  curve: number[];
  bridge: BridgeDto;
}
