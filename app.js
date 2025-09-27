// app.js – Binance Spot proxy for Bubble (Render/Express)
// Endpoints:
//   GET /time
//   GET /avgPrice?symbol=SYMBOL
//   GET /spot/tickerPrice?symbol=SYMBOL
//   GET /spot/dayOpen?symbol=SYMBOL
//   GET /spot/avgEntry?symbol=SYMBOL          (signed; avg buy & qty from your trades)
//   GET /spot/account                          (signed; balances > 0)
//   GET /spot/summary?symbol=SYMBOL            (all-in-one: qty, avgEntry, lastPrice, dayOpen, PnL $, PnL %, Daily %, Daily $)

import express from "express";
import crypto from "node:crypto";

const app = express();
const PORT = process.env.PORT || 3000;

const BINANCE = process.env.BINANCE_BASE || "https://api.binance.com";
const API_KEY = process.env.API_KEY || "";
const API_SECRET = process.env.API_SECRET || "";

// ----- CORS -----
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-MBX-APIKEY");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ----- Helpers -----
async function getJSON(url, init = {}) {
  const r = await fetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

function signQuery(paramsObj, secret) {
  const qs = new URLSearchParams(paramsObj).toString();
  const sig = crypto.createHmac("sha256", secret).update(qs).digest("hex");
  return { qs, sig };
}

async function signedGET(path, paramsObj = {}) {
  if (!API_KEY || !API_SECRET) throw new Error("Missing API_KEY/API_SECRET env vars");
  const signed = signQuery({ ...paramsObj, timestamp: Date.now(), recvWindow: 60000 }, API_SECRET);
  const url = `${BINANCE}${path}?${signed.qs}&signature=${signed.sig}`;
  return getJSON(url, { headers: { "X-MBX-APIKEY": API_KEY } });
}

function detectQuote(symbol) {
  const QUOTES = ["USDT","FDUSD","BUSD","USDC","TUSD","BTC","ETH","BNB","TRY","EUR","BRL","AUD","GBP","RUB"];
  for (const q of QUOTES) if (symbol.endsWith(q)) return q;
  return "USDT";
}

// ----- Endpoints -----

app.get("/", (_req, res) => res.send("OK - Binance Spot proxy"));

app.get("/time", async (_req, res) => {
  try { res.json(await getJSON(`${BINANCE}/api/v3/time`)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// avgPrice הרשמי (ציבורי)
app.get("/avgPrice", async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });
    const data = await getJSON(`${BINANCE}/api/v3/avgPrice?symbol=${symbol}`);
    res.json({ symbol, price: parseFloat(data.price) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// מחיר עדכני (ציבורי)
app.get("/spot/tickerPrice", async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });
    const data = await getJSON(`${BINANCE}/api/v3/ticker/price?symbol=${symbol}`);
    res.json({ symbol, lastPrice: parseFloat(data.price) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// פתיחת היום (ציבורי) – נר 1D אחרון
app.get("/spot/dayOpen", async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });
    const kl = await getJSON(`${BINANCE}/api/v3/klines?symbol=${symbol}&interval=1d&limit=1`);
    if (!Array.isArray(kl) || !kl.length) return res.status(500).json({ error: "No kline data" });
    const open = parseFloat(kl[0][1]);
    res.json({ symbol, dayOpen: open });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ממוצע קנייה אמיתי וכמות נטו לפי ההיסטוריה שלך (חתום)
// שיטה: ממוצע נע משוקלל (WAC). במכירה מקטינים עלות לפי הממוצע עד אותו רגע.
app.get("/spot/avgEntry", async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    const trades = await signedGET("/api/v3/myTrades", { symbol, limit: 1000 });
    trades.sort((a, b) => a.time - b.time);

    let qty = 0;   // כמות שנשארה (base)
    let cost = 0;  // עלות מצטברת (quote)
    const quote = detectQuote(symbol);

    for (const t of trades) {
      const q = parseFloat(t.qty);
      const p = parseFloat(t.price);
      const commission = parseFloat(t.commission || "0");
      const commissionAsset = t.commissionAsset;

      if (t.isBuyer) {
        qty  += q;
        cost += q * p;
        if (commissionAsset === quote) cost += commission; // עמלה ב-quote מגדילה עלות בקנייה
      } else {
        // מכירה: מקטינים עלות לפי הממוצע הנוכחי (לא לפי מחיר המכירה)
        const avg = qty ? cost / qty : 0;
        qty  -= q;
        cost -= avg * q;
        // עמלת מכירה ב-quote לא משנה את עלות הפוזיציה שנותרה (משפיעה על P&L ממומש)
      }
    }

    const avgEntry = qty > 0 ? cost / qty : 0;
    res.json({ symbol, qty: +qty.toFixed(8), avgEntry: +avgEntry.toFixed(8) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// חשבון ספוט (חתום) – מחזיר מאזנים > 0
app.get("/spot/account", async (_req, res) => {
  try {
    const acc = await signedGET("/api/v3/account");
    const balances = (acc.balances || [])
      .map(b => ({ asset: b.asset, free: +b.free, locked: +b.locked, total: +(+b.free + +b.locked).toFixed(8) }))
      .filter(b => b.total > 0);
    res.json({ balances });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// סיכום אחד – מחזיר הכל לטבלה בבאבל: כמות, ממוצע, מחיר נוכחי, פתיחת יום, PnL$/% ו-Daily$/%.
app.get("/spot/summary", async (req, res) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    // בקשות ציבוריות במקביל
    const [ticker, kline] = await Promise.all([
      getJSON(`${BINANCE}/api/v3/ticker/price?symbol=${symbol}`),
      getJSON(`${BINANCE}/api/v3/klines?symbol=${symbol}&interval=1d&limit=1`)
    ]);
    const lastPrice = parseFloat(ticker.price);
    const dayOpen   = parseFloat(kline[0][1]);

    // avgEntry + qty מההיסטוריה שלך
    const { qty, avgEntry } = await (async () => {
      const trades = await signedGET("/api/v3/myTrades", { symbol, limit: 1000 });
      trades.sort((a, b) => a.time - b.time);
      let q = 0, c = 0;
      const quote = detectQuote(symbol);
      for (const t of trades) {
        const qtyT = parseFloat(t.qty);
        const priceT = parseFloat(t.price);
        const comm = parseFloat(t.commission || "0");
        const commAsset = t.commissionAsset;
        if (t.isBuyer) { q += qtyT; c += qtyT * priceT; if (commAsset === quote) c += comm; }
        else { const avg = q ? c / q : 0; q -= qtyT; c -= avg * qtyT; }
      }
      return { qty: +q.toFixed(8), avgEntry: q > 0 ? +(c / q).toFixed(8) : 0 };
    })();

    const pnlValue = +( (lastPrice - avgEntry) * qty ).toFixed(8);
    const pnlPct   = avgEntry ? +(((lastPrice / avgEntry) - 1) * 100).toFixed(4) : 0;
    const dailyPct = +(((lastPrice / dayOpen) - 1) * 100).toFixed(4);
    const dailyVal = +((lastPrice - dayOpen) * qty).toFixed(8);

    res.json({
      symbol,
      qty, avgEntry, lastPrice, dayOpen,
      pnlValue, pnlPct,
      dailyPct, dailyVal
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
