//+------------------------------------------------------------------+
//|                                            Agaba005Bridge.mq5    |
//|              AGABA005 autonomous desk - MT5 bridge EA            |
//|                                                                  |
//|  Streams live quotes + positions to the AGABA005 web engine and  |
//|  executes its orders on this account (demo or live).             |
//|                                                                  |
//|  SETUP                                                           |
//|  1. Tools -> Options -> Expert Advisors:                         |
//|     [x] Allow algorithmic trading                                |
//|     [x] Allow WebRequest for listed URL -> add your ApiUrl       |
//|  2. Compile this file in MetaEditor (F7).                        |
//|  3. Attach to ONE chart (any symbol, any timeframe).             |
//|  4. Set ApiUrl + ApiKey inputs to match your web app.            |
//|  5. Watch the Experts tab: "HB ok" every poll = link is live.    |
//+------------------------------------------------------------------+
#property copyright "AGABA005"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>
CTrade trade;

input string InpApiUrl   = "";                 // ApiUrl - e.g. https://yourapp.com (no trailing slash)
input string InpApiKey   = "agaba-demo-key";   // ApiKey - must match MT5_BRIDGE_KEY on the server
input string InpSymbols  = "EURUSD,GBPUSD,USDJPY,USDCHF,USDCAD,AUDUSD,NZDUSD,EURGBP,EURJPY,GBPJPY,USDTRY,USDZAR,XAUUSD,USOUSD,NGAS"; // Symbols to stream
input int    InpPollMs   = 2000;               // Heartbeat interval (ms)
input int    InpMagic    = 260105;             // Magic number for AGABA005 positions
input int    InpSlippage = 30;                 // Max slippage (points)
input bool   InpDryRun   = false;              // Dry run: report fills without sending orders

string g_syms[];
datetime g_lastM1[];
ulong    g_lastDealTicket = 0;
string   g_hbUrl, g_ackUrl;
long     g_hbCount = 0;
bool     g_linkUp = false;

//+------------------------------------------------------------------+
string San(string s)
{
   StringReplace(s, "|", "/");
   StringReplace(s, "\n", " ");
   return s;
}

string Dstr(double v, int d) { return DoubleToString(v, d); }

//+------------------------------------------------------------------+
int OnInit()
{
   if(InpApiUrl == "")
   {
      Print("AGABA005: ApiUrl input is empty. Set it to your deployed app URL.");
      return INIT_FAILED;
   }
   string base = InpApiUrl;
   if(StringGetCharacter(base, StringLen(base) - 1) == '/')
      base = StringSubstr(base, 0, StringLen(base) - 1);
   g_hbUrl  = base + "/api/mt5/hb";
   g_ackUrl = base + "/api/mt5/ack";

   int n = StringSplit(InpSymbols, ',', g_syms);
   ArrayResize(g_lastM1, n);
   for(int i = 0; i < n; i++)
   {
      StringTrimLeft(g_syms[i]);
      StringTrimRight(g_syms[i]);
      if(!SymbolSelect(g_syms[i], true))
         Print("AGABA005: symbol not available at this broker: ", g_syms[i], " (skipped in streams)");
      g_lastM1[i] = 0;
   }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpSlippage);
   trade.SetAsyncMode(false);

   // don't replay old deals as closes
   HistorySelect(TimeCurrent() - 3600, TimeCurrent() + 5);
   for(int i = 0; i < HistoryDealsTotal(); i++)
   {
      ulong tk = HistoryDealGetTicket(i);
      if(tk > g_lastDealTicket) g_lastDealTicket = tk;
   }

   EventSetMillisecondTimer(InpPollMs);
   Print("AGABA005 bridge initialised -> ", g_hbUrl, " | symbols: ", n, " | magic: ", InpMagic,
         InpDryRun ? " | DRY RUN (no real orders)" : "");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); Comment(""); }

//+------------------------------------------------------------------+
bool HttpPost(const string url, const string body, string &out)
{
   char data[], res[];
   string resHeaders;
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(data, len - 1); // strip trailing null
   string headers = "Content-Type: text/plain\r\nx-agaba-key: " + InpApiKey + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", url, headers, 8000, data, res, resHeaders);
   out = CharArrayToString(res, 0, WHOLE_ARRAY, CP_UTF8);
   if(code == -1)
   {
      int err = GetLastError();
      if(err == 4060)
         Print("AGABA005: URL not allowed. Tools -> Options -> Expert Advisors -> Allow WebRequest for: ", url);
      else
         Print("AGABA005: WebRequest error ", err, " for ", url);
      ResetLastError();
      return false;
   }
   return true;
}

//+------------------------------------------------------------------+
void SendAck(const string line)
{
   string out;
   HttpPost(g_ackUrl, line, out);
}

//+------------------------------------------------------------------+
double NormVol(const string sym, double lots)
{
   double minv = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double maxv = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   if(step <= 0) step = 0.01;
   double v = MathFloor(lots / step) * step;
   v = MathMax(minv, MathMin(maxv, v));
   return NormalizeDouble(v, 2);
}

void GuardStops(const string sym, const bool isBuy, double &sl, double &tp)
{
   double pt   = SymbolInfoDouble(sym, SYMBOL_POINT);
   double lvl  = (double)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL) * pt + pt * 2;
   double bid  = SymbolInfoDouble(sym, SYMBOL_BID);
   double ask  = SymbolInfoDouble(sym, SYMBOL_ASK);
   if(isBuy)
   {
      if(sl > 0 && bid - sl < lvl) sl = bid - lvl;
      if(tp > 0 && tp - bid < lvl) tp = bid + lvl;
   }
   else
   {
      if(sl > 0 && sl - ask < lvl) sl = ask + lvl;
      if(tp > 0 && ask - tp < lvl) tp = ask - lvl;
   }
   int digs = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   sl = NormalizeDouble(sl, digs);
   tp = NormalizeDouble(tp, digs);
}

//+------------------------------------------------------------------+
void HandleOpen(const string id, const string sym, const string side, const string lotsS, const string slS, const string tpS)
{
   if(!SymbolSelect(sym, true)) { SendAck("ACK|" + id + "|ERR|NO_SYMBOL"); return; }
   bool isBuy = (side == "BUY");
   double lots = NormVol(sym, StringToDouble(lotsS));
   double sl = StringToDouble(slS);
   double tp = StringToDouble(tpS);
   if(lots <= 0) { SendAck("ACK|" + id + "|ERR|BAD_VOLUME"); return; }

   GuardStops(sym, isBuy, sl, tp);

   if(InpDryRun)
   {
      double px = isBuy ? SymbolInfoDouble(sym, SYMBOL_ASK) : SymbolInfoDouble(sym, SYMBOL_BID);
      SendAck("ACK|" + id + "|OK|" + IntegerToString(99000000 + (int)StringToInteger(id)) + "|" + Dstr(px, (int)SymbolInfoInteger(sym, SYMBOL_DIGITS)));
      Print("AGABA005 DRYRUN: ", side, " ", lots, " ", sym, " sl=", sl, " tp=", tp);
      return;
   }

   trade.SetTypeFillingBySymbol(sym);
   bool ok = isBuy ? trade.Buy(lots, sym, 0.0, sl, tp, "AGABA005 #" + id)
                   : trade.Sell(lots, sym, 0.0, sl, tp, "AGABA005 #" + id);
   if(!ok)
   {
      SendAck("ACK|" + id + "|ERR|" + IntegerToString(trade.ResultRetcode()) + "|" + San(trade.ResultRetcodeDescription()));
      Print("AGABA005: order send failed ", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
      return;
   }

   ulong posTicket = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == sym && PositionGetInteger(POSITION_MAGIC) == InpMagic)
      {
         if((isBuy && PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ||
            (!isBuy && PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_SELL))
         { posTicket = tk; break; }
      }
   }
   int digs = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   SendAck("ACK|" + id + "|OK|" + IntegerToString((long)posTicket) + "|" + Dstr(trade.ResultPrice(), digs));
   Print("AGABA005: FILLED ", side, " ", lots, " ", sym, " @ ", Dstr(trade.ResultPrice(), digs), " ticket=", posTicket);
}

void HandleModify(const string id, const string ticketS, const string slS)
{
   ulong tk = (ulong)StringToInteger(ticketS);
   if(!PositionSelectByTicket(tk)) { SendAck("ACK|" + id + "|ERR|POS_NOT_FOUND"); return; }
   string sym = PositionGetString(POSITION_SYMBOL);
   double tp = PositionGetDouble(POSITION_TP);
   double sl = StringToDouble(slS);
   int digs = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   sl = NormalizeDouble(sl, digs);

   if(InpDryRun) { SendAck("ACK|" + id + "|OK|" + ticketS + "|" + Dstr(sl, digs)); return; }
   bool ok = trade.PositionModify(tk, sl, tp);
   if(!ok)
   {
      SendAck("ACK|" + id + "|ERR|" + IntegerToString(trade.ResultRetcode()) + "|" + San(trade.ResultRetcodeDescription()));
      return;
   }
   SendAck("ACK|" + id + "|OK|" + ticketS + "|" + Dstr(sl, digs));
}

void HandleClose(const string id, const string ticketS)
{
   ulong tk = (ulong)StringToInteger(ticketS);
   if(!PositionSelectByTicket(tk)) { SendAck("ACK|" + id + "|OK|" + ticketS + "|0"); return; }
   string sym = PositionGetString(POSITION_SYMBOL);
   int digs = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double px = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY
      ? SymbolInfoDouble(sym, SYMBOL_BID) : SymbolInfoDouble(sym, SYMBOL_ASK);

   if(InpDryRun) { SendAck("ACK|" + id + "|OK|" + ticketS + "|" + Dstr(px, digs)); return; }
   bool ok = trade.PositionClose(tk);
   if(!ok)
   {
      SendAck("ACK|" + id + "|ERR|" + IntegerToString(trade.ResultRetcode()) + "|" + San(trade.ResultRetcodeDescription()));
      return;
   }
   SendAck("ACK|" + id + "|OK|" + ticketS + "|" + Dstr(trade.ResultPrice(), digs));
   Print("AGABA005: CLOSED ticket=", tk, " @ ", Dstr(trade.ResultPrice(), digs));
}

void HandleCommands(const string resp)
{
   if(resp == "" || StringFind(resp, "CMD|") < 0) return;
   string lines[];
   int n = StringSplit(resp, '\n', lines);
   for(int i = 0; i < n; i++)
   {
      if(StringFind(lines[i], "CMD|") != 0) continue;
      string f[];
      int m = StringSplit(lines[i], '|', f);
      if(m < 3) continue;
      string kind = f[2];
      if(kind == "OPEN" && m >= 8)   HandleOpen(f[1], f[3], f[4], f[5], f[6], f[7]);
      else if(kind == "MODIFY" && m >= 5)  HandleModify(f[1], f[3], f[4]);
      else if(kind == "CLOSE" && m >= 4)   HandleClose(f[1], f[3]);
   }
}

//+------------------------------------------------------------------+
void OnTimer()
{
   string body = "";

   // terminal snapshot
   body += "TERM|" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))
        + "|" + San(AccountInfoString(ACCOUNT_SERVER))
        + "|" + San(AccountInfoString(ACCOUNT_COMPANY))
        + "|" + San(AccountInfoString(ACCOUNT_CURRENCY))
        + "|" + Dstr(AccountInfoDouble(ACCOUNT_BALANCE), 2)
        + "|" + Dstr(AccountInfoDouble(ACCOUNT_EQUITY), 2)
        + "|" + Dstr(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + "\n";

   // quotes + fresh M1 closes
   for(int i = 0; i < ArraySize(g_syms); i++)
   {
      string sym = g_syms[i];
      double bid = SymbolInfoDouble(sym, SYMBOL_BID);
      double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
      int digs = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      if(bid > 0 && ask > 0)
         body += "PX|" + sym + "|" + Dstr(bid, digs) + "|" + Dstr(ask, digs) + "\n";

      datetime bt = iTime(sym, PERIOD_M1, 0);
      if(bt != g_lastM1[i])
      {
         g_lastM1[i] = bt;
         double c[];
         int got = CopyClose(sym, PERIOD_M1, 1, 60, c);
         if(got > 30)
         {
            string m1 = "M1|" + sym;
            for(int j = 0; j < got; j++) m1 += "|" + Dstr(c[j], digs);
            body += m1 + "\n";
         }
      }
   }

   // open positions with our magic
   int posCount = 0;
   string posLines = "";
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      int digs = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      posLines += "POS|" + IntegerToString((long)tk)
         + "|" + sym
         + "|" + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "BUY" : "SELL")
         + "|" + Dstr(PositionGetDouble(POSITION_VOLUME), 2)
         + "|" + Dstr(PositionGetDouble(POSITION_PRICE_OPEN), digs)
         + "|" + Dstr(PositionGetDouble(POSITION_PRICE_CURRENT), digs)
         + "|" + Dstr(PositionGetDouble(POSITION_SL), digs)
         + "|" + Dstr(PositionGetDouble(POSITION_TP), digs)
         + "|" + Dstr(PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP), 2)
         + "\n";
      posCount++;
   }
   body += "POSCOUNT|" + IntegerToString(posCount) + "\n" + posLines + "POSEND|\n";

   // closed deals since last heartbeat
   HistorySelect(TimeCurrent() - 7200, TimeCurrent() + 5);
   for(int i = 0; i < HistoryDealsTotal(); i++)
   {
      ulong dt = HistoryDealGetTicket(i);
      if(dt <= g_lastDealTicket) continue;
      g_lastDealTicket = dt;
      if(HistoryDealGetInteger(dt, DEAL_MAGIC) != InpMagic) continue;
      long entry = HistoryDealGetInteger(dt, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_INOUT) continue;
      ulong posId = (ulong)HistoryDealGetInteger(dt, DEAL_POSITION_ID);
      double pnl = HistoryDealGetDouble(dt, DEAL_PROFIT)
                 + HistoryDealGetDouble(dt, DEAL_SWAP)
                 + HistoryDealGetDouble(dt, DEAL_COMMISSION);
      string sym = HistoryDealGetString(dt, DEAL_SYMBOL);
      int digs = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      body += "CLOSED|" + IntegerToString((long)posId) + "|" + Dstr(pnl, 2)
            + "|" + Dstr(HistoryDealGetDouble(dt, DEAL_PRICE), digs) + "\n";
   }

   string resp;
   if(HttpPost(g_hbUrl, body, resp))
   {
      g_hbCount++;
      if(!g_linkUp)
      {
         g_linkUp = true;
         Print("AGABA005: LINK ESTABLISHED - heartbeat flowing. Watch the desk switch to MT5 LINKED.");
      }
      if(g_hbCount % 150 == 0) Print("AGABA005: link alive, heartbeat #", g_hbCount);
      Comment("AGABA005 BRIDGE  |  LINK UP  |  HB #", g_hbCount,
              "  |  acct ", IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)),
              "  |  eq ", Dstr(AccountInfoDouble(ACCOUNT_EQUITY), 2));
      HandleCommands(resp);
   }
   else
   {
      g_linkUp = false;
      Comment("AGABA005 BRIDGE  |  LINK DOWN  |  see Experts tab for the reason");
   }
}
//+------------------------------------------------------------------+
