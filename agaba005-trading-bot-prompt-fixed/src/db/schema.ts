import {
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ─── Trades ──────────────────────────────────────────────────────────────────
// Every position the desk takes. Open rows are mutated as the trade is managed
// (trailing stop, best price) and finalized with exit / pnl / outcome on close.
export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // LONG | SHORT
  status: text("status").notNull().default("OPEN"), // OPEN | CLOSED
  setupReason: text("setup_reason").notNull(),
  confluence: jsonb("confluence").$type<string[]>().notNull().default([]),
  score: integer("score").notNull(),
  qty: doublePrecision("qty").notNull(),
  entry: doublePrecision("entry").notNull(),
  stopLoss: doublePrecision("stop_loss").notNull(),
  takeProfit: doublePrecision("take_profit").notNull(),
  riskAmount: doublePrecision("risk_amount").notNull(),
  riskPercent: doublePrecision("risk_percent").notNull(),
  riskReward: doublePrecision("risk_reward").notNull(),
  trailActivateR: doublePrecision("trail_activate_r").notNull(),
  trailDistance: doublePrecision("trail_distance").notNull(),
  trailingActive: boolean("trailing_active").notNull().default(false),
  currentStop: doublePrecision("current_stop").notNull(),
  bestPrice: doublePrecision("best_price").notNull(),
  exit: doublePrecision("exit"),
  exitReason: text("exit_reason"), // TP | SL | TRAIL | SESSION | MANUAL
  pnl: doublePrecision("pnl"),
  outcome: text("outcome"), // WIN | LOSS
  simOpen: text("sim_open"),
  simClose: text("sim_close"),
  source: text("source").notNull().default("SIM"), // SIM | LINKED
  ticket: doublePrecision("ticket"),
  dayIndex: integer("day_index").notNull().default(1),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

// ─── Bot event / decision log ────────────────────────────────────────────────
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // scan | signal | execute | reject | close | report | system
  message: text("message").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  simTime: text("sim_time"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Singleton bot state ─────────────────────────────────────────────────────
export const botState = pgTable("bot_state", {
  id: serial("id").primaryKey(),
  equity: doublePrecision("equity").notNull(),
  dayStartEquity: doublePrecision("day_start_equity").notNull(),
  dayIndex: integer("day_index").notNull().default(1),
  running: boolean("running").notNull().default(true),
  haltedReason: text("halted_reason"),
  riskPct: doublePrecision("risk_pct").notNull().default(1.5),
  simMs: doublePrecision("sim_ms").notNull(),
  threshold: integer("threshold").notNull().default(6),
  mode: text("mode").notNull().default("SIM"), // SIM | LINKED
  marketJson: jsonb("market_json").$type<Record<string, { price: number; history: number[] }>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── MT5 bridge: terminal heartbeat ─────────────────────────────────────────
export const terminal = pgTable("terminal", {
  id: serial("id").primaryKey(),
  account: text("account"),
  server: text("server"),
  company: text("company"),
  currency: text("currency"),
  balance: doublePrecision("balance"),
  equity: doublePrecision("equity"),
  marginFree: doublePrecision("margin_free"),
  posCount: integer("pos_count").notNull().default(0),
  lastHb: timestamp("last_hb", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── MT5 bridge: order command queue ────────────────────────────────────────
export const mt5Commands = pgTable("mt5_commands", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // OPEN | MODIFY | CLOSE
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("PENDING"), // PENDING | SENT | ACKED | FAILED | EXPIRED
  ticket: doublePrecision("ticket"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TradeRow = typeof trades.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type BotStateRow = typeof botState.$inferSelect;
