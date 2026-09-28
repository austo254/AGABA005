// ─────────────────────────────────────────────────────────────────────────────
// AGABA005 — market simulation + technical analysis layer
// Each engine tick represents one M5 candle close. Prices are generated with a
// regime-switching random walk (trend + volatility clustering) steered by
// "narratives" so that high-conviction setups resolve realistically.
// ─────────────────────────────────────────────────────────────────────────────

export type SymbolKind = "MAJOR" | "MINOR" | "EXOTIC" | "METAL" | "ENERGY";
export type Liquidity = "DEEP" | "ACTIVE" | "THIN";

export interface SymbolSpec {
  code: string;
  name: string;
  kind: SymbolKind;
  base: number;
  pip: number;
  spreadPips: number;
  vol: number; // per-tick stdev as fraction of price
  decimals: number;
  liquidity: Liquidity;
}

export const SYMBOLS: SymbolSpec[] = [
  { code: "EUR/USD", name: "Euro / US Dollar", kind: "MAJOR", base: 1.0862, pip: 0.0001, spreadPips: 0.6, vol: 0.00030, decimals: 5, liquidity: "DEEP" },
  { code: "GBP/USD", name: "Pound / US Dollar", kind: "MAJOR", base: 1.2684, pip: 0.0001, spreadPips: 0.9, vol: 0.00036, decimals: 5, liquidity: "DEEP" },
  { code: "USD/JPY", name: "US Dollar / Yen", kind: "MAJOR", base: 151.42, pip: 0.01, spreadPips: 0.8, vol: 0.00034, decimals: 3, liquidity: "DEEP" },
  { code: "USD/CHF", name: "US Dollar / Swiss Franc", kind: "MAJOR", base: 0.8827, pip: 0.0001, spreadPips: 1.0, vol: 0.0003, decimals: 5, liquidity: "DEEP" },
  { code: "USD/CAD", name: "US Dollar / Canadian Dollar", kind: "MAJOR", base: 1.3642, pip: 0.0001, spreadPips: 1.1, vol: 0.00033, decimals: 5, liquidity: "DEEP" },
  { code: "AUD/USD", name: "Aussie / US Dollar", kind: "MAJOR", base: 0.6591, pip: 0.0001, spreadPips: 1.0, vol: 0.00038, decimals: 5, liquidity: "DEEP" },
  { code: "NZD/USD", name: "Kiwi / US Dollar", kind: "MAJOR", base: 0.6118, pip: 0.0001, spreadPips: 1.3, vol: 0.00036, decimals: 5, liquidity: "ACTIVE" },
  { code: "EUR/GBP", name: "Euro / Pound", kind: "MINOR", base: 0.8556, pip: 0.0001, spreadPips: 1.1, vol: 0.00028, decimals: 5, liquidity: "ACTIVE" },
  { code: "EUR/JPY", name: "Euro / Yen", kind: "MINOR", base: 164.31, pip: 0.01, spreadPips: 1.2, vol: 0.0004, decimals: 3, liquidity: "ACTIVE" },
  { code: "GBP/JPY", name: "Pound / Yen", kind: "MINOR", base: 192.15, pip: 0.01, spreadPips: 1.6, vol: 0.00048, decimals: 3, liquidity: "ACTIVE" },
  { code: "USD/TRY", name: "US Dollar / Turkish Lira", kind: "EXOTIC", base: 36.84, pip: 0.0001, spreadPips: 12, vol: 0.00062, decimals: 4, liquidity: "THIN" },
  { code: "USD/ZAR", name: "US Dollar / Rand", kind: "EXOTIC", base: 18.24, pip: 0.0001, spreadPips: 14, vol: 0.00085, decimals: 4, liquidity: "THIN" },
  { code: "XAU/USD", name: "Gold Spot", kind: "METAL", base: 2915.4, pip: 0.1, spreadPips: 2.5, vol: 0.00055, decimals: 2, liquidity: "DEEP" },
  { code: "WTI/USD", name: "Crude Oil WTI", kind: "ENERGY", base: 72.84, pip: 0.01, spreadPips: 3, vol: 0.00095, decimals: 2, liquidity: "ACTIVE" },
  { code: "NG/USD", name: "Natural Gas", kind: "ENERGY", base: 3.42, pip: 0.001, spreadPips: 6, vol: 0.0016, decimals: 3, liquidity: "ACTIVE" },
];

export interface Story {
  dir: 1 | -1;
  amp: number; // absolute price drift per tick
  left: number;
}

export interface SymState {
  spec: SymbolSpec;
  price: number;
  prev: number;
  open24: number;
  history: number[];
  regime: { drift: number; left: number };
  story: Story | null;
}

// ── math helpers ─────────────────────────────────────────────────────────────
export function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sma(arr: number[], n: number): number {
  if (arr.length < n) return arr[arr.length - 1] ?? 0;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += arr[i];
  return s / n;
}

function emaSeries(arr: number[], n: number): number[] {
  if (arr.length === 0) return [];
  const k = 2 / (n + 1);
  const out: number[] = [arr[0]];
  for (let i = 1; i < arr.length; i++) out.push(arr[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsi(arr: number[], n = 14): number {
  if (arr.length < n + 2) return 50;
  let g = 0;
  let l = 0;
  for (let i = arr.length - n; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  if (l === 0) return 100;
  const rs = g / n / (l / n);
  return 100 - 100 / (1 + rs);
}

function atr(arr: number[], n = 14): number {
  if (arr.length < n + 2) return 0;
  let s = 0;
  for (let i = arr.length - n; i < arr.length; i++) s += Math.abs(arr[i] - arr[i - 1]);
  return (s / n) * 1.18; // range proxy fudge (close-close understates true range)
}

// ── session model (UTC) ─────────────────────────────────────────────────────
export function sessFactor(hourUTC: number): number {
  let f = 0.55;
  if (hourUTC >= 7 && hourUTC < 12) f += 0.4; // London
  if (hourUTC >= 12 && hourUTC < 16.5) f += 0.35; // New York overlap
  if (hourUTC >= 21 || hourUTC < 1.5) f -= 0.18; // APAC lull
  return Math.max(0.32, Math.min(1.32, f));
}

export function sessLabel(hourUTC: number): string {
  if (hourUTC >= 12 && hourUTC < 16.5) return "LDN·NY OVERLAP";
  if (hourUTC >= 7 && hourUTC < 12) return "LONDON";
  if (hourUTC >= 16.5 && hourUTC < 21) return "NEW YORK";
  if (hourUTC >= 21 || hourUTC < 1.5) return "APAC LULL";
  if (hourUTC >= 1.5 && hourUTC < 7) return "TOKYO";
  return "SYDNEY";
}

export function effSpreadPips(spec: SymbolSpec, sessF: number): number {
  const m = sessF < 0.5 ? 1.9 : sessF < 0.75 ? 1.35 : 1;
  return spec.spreadPips * m;
}

// ── market lifecycle ─────────────────────────────────────────────────────────
export function initMarket(
  saved?: Record<string, { price: number; history: number[] }> | null,
): Map<string, SymState> {
  const map = new Map<string, SymState>();
  for (const spec of SYMBOLS) {
    const sv = saved?.[spec.code];
    const history =
      sv?.history && sv.history.length > 60 ? sv.history.slice(-240) : seedHistory(spec);
    const price = sv?.price && Number.isFinite(sv.price) ? sv.price : history[history.length - 1];
    map.set(spec.code, {
      spec,
      price,
      prev: price,
      open24: price,
      history,
      regime: { drift: (Math.random() - 0.5) * spec.vol * 0.4, left: 30 + Math.random() * 60 },
      story: null,
    });
  }
  return map;
}

function seedHistory(spec: SymbolSpec): number[] {
  const out: number[] = [];
  let p = spec.base;
  let drift = 0;
  let left = 0;
  for (let i = 0; i < 240; i++) {
    if (left <= 0) {
      drift = (Math.random() - 0.5) * spec.vol * (Math.random() < 0.3 ? 0.8 : 1.6);
      left = 20 + Math.random() * 70;
    }
    left--;
    p = Math.max(p * (1 + drift + gauss() * spec.vol), spec.base * 0.5);
    out.push(p);
  }
  return out;
}

export function tickSymbol(s: SymState, sessF: number): void {
  const { spec } = s;
  if (s.regime.left <= 0) {
    const cont = Math.random() < 0.62 ? Math.sign(s.regime.drift || 1) : -Math.sign(s.regime.drift || 1);
    s.regime = {
      drift: cont * spec.vol * (0.1 + Math.random() * 0.34),
      left: 16 + Math.random() * 72,
    };
  }
  s.regime.left--;

  let shock = gauss() * spec.vol * sessF;
  let driftPct = s.regime.drift * sessF;

  if (s.story) {
    // narrative steering: damp opposing shocks, add absolute drift
    if (Math.sign(shock) !== s.story.dir) shock *= 0.32;
    const absMove = s.story.dir * s.story.amp * sessF;
    s.prev = s.price;
    s.price = Math.max(0.0001, s.price * Math.exp(driftPct) + absMove + s.price * shock);
    s.story.left--;
    if (s.story.left <= 0) s.story = null;
  } else {
    // gentle mean reversion toward the 50-sma keeps levels honest
    const m50 = sma(s.history, 50);
    const rev = m50 ? -0.0022 * (s.price / m50 - 1) : 0;
    s.prev = s.price;
    s.price = Math.max(0.0001, s.price * (1 + driftPct + shock + rev));
  }

  s.history.push(s.price);
  if (s.history.length > 240) s.history.splice(0, s.history.length - 240);
}

// ── technical evaluation ─────────────────────────────────────────────────────
export interface EvalResult {
  score: number;
  dir: "LONG" | "SHORT" | null;
  blocked: boolean;
  factors: string[];
  blocks: string[];
  atr: number;
  rsi: number;
  trend: "UP" | "DOWN" | "FLAT";
  slLevel: number | null;
  swingHigh: number;
  swingLow: number;
  macdRising: boolean;
  trigger: "BREAKOUT" | "PULLBACK" | "RETEST" | null;
  pip: number;
  spreadPips: number;
}

function fmtPx(x: number, dec: number): string {
  return x.toFixed(dec);
}

export function evaluate(s: SymState, sessF: number, news: boolean): EvalResult {
  const { spec } = s;
  const h = s.history;
  const price = s.price;
  const dec = spec.decimals;
  const atrV = atr(h);
  const rsiV = rsi(h);
  const s20 = sma(h, 20);
  const s50 = sma(h, 50);
  const e12 = emaSeries(h.slice(-80), 12);
  const e26 = emaSeries(h.slice(-80), 26);
  const macdLine = e12.map((v, i) => v - e26[i]);
  const sig = emaSeries(macdLine.slice(-40), 9);
  const hist = macdLine[macdLine.length - 1] - sig[sig.length - 1];
  const histPrev = macdLine[macdLine.length - 2] - sig[sig.length - 2];
  const macdRising = hist > 0 && hist >= histPrev;
  const macdFalling = hist < 0 && hist <= histPrev;

  const recent = h.slice(-34, -4);
  const swingHigh = Math.max(...recent);
  const swingLow = Math.min(...recent);
  const near8 = h.slice(-8);
  const spread = effSpreadPips(spec, sessF);
  const volRegime = atrV / price;

  const upTrend = price > s50 && s20 > s50 * 0.9995;
  const dnTrend = price < s50 && s20 < s50 * 1.0005;
  const trend: EvalResult["trend"] = upTrend ? "UP" : dnTrend ? "DOWN" : "FLAT";

  const longs: string[] = [];
  const shorts: string[] = [];
  const blocks: string[] = [];
  let lScore = 0;
  let sScore = 0;
  let lTrigger: EvalResult["trigger"] = null;
  let sTrigger: EvalResult["trigger"] = null;
  let lSl: number | null = null;
  let sSl: number | null = null;

  // trend
  if (upTrend) {
    lScore += 2;
    longs.push(`Trend alignment — SMA20 above SMA50, price holding bullish structure`);
  }
  if (dnTrend) {
    sScore += 2;
    shorts.push(`Trend alignment — SMA20 below SMA50, price under bearish control`);
  }

  // momentum
  if (rsiV >= 52 && rsiV <= 71) {
    lScore += 1;
    longs.push(`RSI(14) constructive at ${rsiV.toFixed(0)} with headroom`);
  } else if (rsiV > 74) {
    blocks.push(`RSI overbought (${rsiV.toFixed(0)}) — late-entry chase risk`);
  }
  if (rsiV <= 48 && rsiV >= 29) {
    sScore += 1;
    shorts.push(`RSI(14) pressing ${rsiV.toFixed(0)} with downside room`);
  } else if (rsiV < 26) {
    blocks.push(`RSI oversold (${rsiV.toFixed(0)}) — bounce risk against shorts`);
  }
  if (macdRising) {
    lScore += 1;
    longs.push(`MACD histogram positive and expanding`);
  }
  if (macdFalling) {
    sScore += 1;
    shorts.push(`MACD histogram negative and expanding`);
  }

  const range = swingHigh - swingLow;
  // price action triggers — stops anchor to the structure that defined the trade
  if (price > swingHigh) {
    lScore += 2;
    lTrigger = "BREAKOUT";
    lSl = swingHigh - range * 0.38; // behind the breakout base
    longs.push(`Breakout through ${fmtPx(swingHigh, dec)} swing resistance`);
  }
  if (price < swingLow) {
    sScore += 2;
    sTrigger = "BREAKOUT";
    sSl = swingLow + range * 0.38;
    shorts.push(`Breakdown through ${fmtPx(swingLow, dec)} swing support`);
  }
  const minNear = Math.min(...near8);
  const maxNear = Math.max(...near8);
  if (!lTrigger && upTrend && minNear <= s20 + atrV * 0.4 && price > s20 && macdRising) {
    lScore += 2;
    lTrigger = "PULLBACK";
    lSl = minNear - atrV * 0.3; // beneath the pullback low
    longs.push(`Pullback respected SMA20 dynamic support — buyers defending`);
  }
  if (!sTrigger && dnTrend && maxNear >= s20 - atrV * 0.4 && price < s20 && macdFalling) {
    sScore += 2;
    sTrigger = "PULLBACK";
    sSl = maxNear + atrV * 0.3;
    shorts.push(`Pullback faded at SMA20 dynamic resistance — sellers defending`);
  }
  if (!lTrigger && upTrend && price > swingHigh * 0.9998 && price < swingHigh + atrV * 0.35) {
    lScore += 2;
    lTrigger = "RETEST";
    lSl = swingHigh - atrV * 0.85; // below the broken level
    longs.push(`Retest of broken ${fmtPx(swingHigh, dec)} resistance holding as support`);
  }
  if (!sTrigger && dnTrend && price < swingLow * 1.0002 && price > swingLow - atrV * 0.35) {
    sScore += 2;
    sTrigger = "RETEST";
    sSl = swingLow + atrV * 0.85;
    shorts.push(`Retest of broken ${fmtPx(swingLow, dec)} support rejected from below`);
  }

  // structure / logical invalidation
  if (lTrigger && lSl != null) {
    const d = price - lSl;
    if (d > 0 && d <= atrV * 3.15) {
      lScore += 1;
      longs.push(`Logical invalidation ${(d / spec.pip).toFixed(1)}p below at ${fmtPx(lSl, dec)}`);
    } else if (d > atrV * 3.6) {
      blocks.push(`Nearest bull structure too wide (${(d / spec.pip).toFixed(0)}p) — no logical stop`);
    }
  }
  if (sTrigger && sSl != null) {
    const d = sSl - price;
    if (d > 0 && d <= atrV * 3.15) {
      sScore += 1;
      shorts.push(`Logical invalidation ${(d / spec.pip).toFixed(1)}p above at ${fmtPx(sSl, dec)}`);
    } else if (d > atrV * 3.6) {
      blocks.push(`Nearest bear structure too wide (${(d / spec.pip).toFixed(0)}p) — no logical stop`);
    }
  }

  // execution quality gates
  if (sessF >= 0.85) {
    lScore += 1;
    sScore += 1;
    longs.push(`Prime liquidity window — tight spreads, clean fills`);
    shorts.push(`Prime liquidity window — tight spreads, clean fills`);
  } else if (sessF < 0.52) {
    blocks.push(`Outside liquidity window (${spread.toFixed(1)}p spread) — execution risk`);
  }
  if (spread * spec.pip > atrV * 0.9) {
    blocks.push(`Spread/ATR ratio unfavorable — cost eats the edge`);
  }
  if (volRegime > spec.vol * 2.6) {
    blocks.push(`Volatility abnormally elevated (${(volRegime * 1e4).toFixed(1)}bp/bar)`);
  } else if (volRegime < spec.vol * 0.3) {
    blocks.push(`Volatility compressed — no follow-through fuel`);
  }
  if (news) {
    blocks.push(`High-impact release window — standing aside per protocol`);
  }

  const dir: EvalResult["dir"] = lTrigger || sTrigger ? (lScore >= sScore ? "LONG" : "SHORT") : null;
  const score = dir === "LONG" ? lScore : dir === "SHORT" ? sScore : Math.max(lScore, sScore);
  const factors = dir === "SHORT" ? shorts : longs;

  return {
    score,
    dir,
    blocked: blocks.length > 0,
    factors,
    blocks,
    atr: atrV,
    rsi: rsiV,
    trend,
    slLevel: dir === "LONG" ? lSl : dir === "SHORT" ? sSl : null,
    swingHigh,
    swingLow,
    macdRising,
    trigger: dir === "LONG" ? lTrigger : sTrigger,
    pip: spec.pip,
    spreadPips: spread,
  };
}
