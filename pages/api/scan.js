// pages/api/scan.js — v4.0 — based on official Sahmk API docs

const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  if (req.method === "GET")
    return res.status(200).json({ version: "4.0", status: "ok" });
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { cfg } = req.body;
  const sahmkKey = process.env.SAHMK_API_KEY;
  if (!sahmkKey)
    return res.status(500).json({ error: "SAHMK_API_KEY غير موجود" });

  try {
    // ── 1. جلب قائمة أسهم TASI فقط ──────────────────────────
    const listRes = await fetch(`${BASE}/companies/?market=TASI&limit=500`, {
      headers: { "X-API-Key": sahmkKey },
    });
    if (!listRes.ok) return res.status(500).json({ error: `فشل جلب الأسهم: ${listRes.status}` });

    const listData = await listRes.json();
    const stocks = (listData.results || []).filter(s =>
      s.symbol &&
      /^[1-9]\d{3}$/.test(s.symbol) &&
      s.market === "TASI" &&
      s.status === "active"
    );

    if (!stocks.length)
      return res.status(200).json({ results: [], scannedAt: new Date().toISOString() });

    const results = [];

    for (const stock of stocks) {
      const symbol = stock.symbol;
      try {
        const stochResults = {}, dmaResults = {};

        for (const [key, cfgKey, interval] of [
          ["daily",   "stochDaily",   "1d"],
          ["weekly",  "stochWeekly",  "1w"],
          ["monthly", "stochMonthly", "1m"],
        ]) {
          if (!cfg[cfgKey]) continue;
          const data = await fetchOHLC(sahmkKey, symbol, interval);
          if (data) stochResults[key] = calcStoch(data.closes, data.highs, data.lows, 5, 3, 3);
        }

        for (const [key, cfgKey, interval] of [
          ["daily",   "dmaDaily",   "1d"],
          ["weekly",  "dmaWeekly",  "1w"],
          ["monthly", "dmaMonthly", "1m"],
        ]) {
          if (!cfg[cfgKey]) continue;
          const data = await fetchOHLC(sahmkKey, symbol, interval);
          if (data) dmaResults[key] = calcDMA(data.closes, 10, 50, 10);
        }

        // جلب closes اليومية للـ SMA50 إذا احتجنا
        let dailyCloses = null;
        if ([cfg.stochDailySMA50,cfg.stochWeeklySMA50,cfg.stochMonthlySMA50,
             cfg.dmaDailySMA50,cfg.dmaWeeklySMA50,cfg.dmaMonthlySMA50].some(Boolean)) {
          const dData = await fetchOHLC(sahmkKey, symbol, "1d");
          if (dData) dailyCloses = dData.closes;
        }
        const evaluation = evalSignal(stochResults, dmaResults, cfg, dailyCloses);

        results.push({
          symbol,
          name:  stock.name_ar || stock.name_en || symbol,
          pass:  evaluation.pass,
          k:     evaluation.k    != null ? +evaluation.k.toFixed(2)    : null,
          d:     evaluation.d    != null ? +evaluation.d.toFixed(2)    : null,
          dif:   evaluation.dif  != null ? +evaluation.dif.toFixed(4)  : null,
          difma: evaluation.difma!= null ? +evaluation.difma.toFixed(4): null,
        });
      } catch { continue; }
    }

    return res.status(200).json({ results, scannedAt: new Date().toISOString() });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── جلب OHLC ─────────────────────────────────────────────────────
async function fetchOHLC(apiKey, symbol, interval) {
  const to   = new Date().toISOString().split("T")[0];
  const days = interval === "1d" ? 400 : interval === "1w" ? 730 : 1825;
  const from = new Date(Date.now() - days*24*60*60*1000).toISOString().split("T")[0];

  const url = `${BASE}/historical/${symbol}/?interval=${interval}&from=${from}&to=${to}`;
  const r   = await fetch(url, { headers: { "X-API-Key": apiKey } });
  if (!r.ok) return null;

  const json    = await r.json();
  const candles = json.data || [];
  if (candles.length < 10) return null;

  const sorted = [...candles].sort((a, b) => new Date(a.date) - new Date(b.date));

  const lastDate = new Date(sorted[sorted.length-1].date);
  if ((Date.now() - lastDate) / 86400000 > 7) return null;

  return {
    closes: sorted.map(c => +c.close),
    highs:  sorted.map(c => +c.high),
    lows:   sorted.map(c => +c.low),
  };
}

// ── Stochastic 5,3,3 ─────────────────────────────────────────────
function calcStoch(closes, highs, lows, kPeriod, smooth, dPeriod) {
  const rawK = [];
  for (let i = kPeriod-1; i < closes.length; i++) {
    let hh = highs[i], ll = lows[i];
    for (let j = i-kPeriod+1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j]  < ll) ll = lows[j];
    }
    rawK.push(hh === ll ? 50 : ((closes[i]-ll)/(hh-ll))*100);
  }

  const K = [];
  for (let i = smooth-1; i < rawK.length; i++) {
    let sum = 0;
    for (let j = i-smooth+1; j <= i; j++) sum += rawK[j];
    K.push(sum / smooth);
  }

  const D = [];
  for (let i = dPeriod-1; i < K.length; i++) {
    let sum = 0;
    for (let j = i-dPeriod+1; j <= i; j++) sum += K[j];
    D.push(sum / dPeriod);
  }

  const k     = K[K.length-1];
  const kPrev = K[K.length-2];
  const d     = D[D.length-1];
  const dPrev = D[D.length-2];

  const crossedLastBar = kPrev < dPrev && k > d;
  const kAbovePrev     = kPrev > dPrev;

  return { k, kPrev, d, dPrev, crossedLastBar, kAbovePrev };
}

// ── DMA 10,50,10 ─────────────────────────────────────────────────
function calcDMA(closes, fast, slow, signal) {
  if (closes.length < slow + signal) return null;
  const difArr = [];
  for (let i = slow-1; i < closes.length; i++) {
    let sF = 0, sS = 0;
    for (let j = i-fast+1; j <= i; j++) sF += closes[j];
    for (let j = i-slow+1; j <= i; j++) sS += closes[j];
    difArr.push(sF/fast - sS/slow);
  }
  const k2 = 2/(signal+1);
  let difma = difArr.slice(0, signal).reduce((a,b)=>a+b)/signal;
  for (let i = signal; i < difArr.length; i++) difma = difArr[i]*k2 + difma*(1-k2);

  let difmaPrev = difArr.slice(0, signal-1).reduce((a,b)=>a+b)/(signal-1);
  for (let i = signal-1; i < difArr.length-1; i++) difmaPrev = difArr[i]*k2 + difmaPrev*(1-k2);

  const dif     = difArr[difArr.length-1];
  const difPrev = difArr[difArr.length-2];

  const crossedLastBar = difPrev < difmaPrev && dif > difma;
  const difAbovePrev   = difPrev > difmaPrev;

  return { dif, difPrev, difma, difmaPrev, crossedLastBar, difAbovePrev };
}

// ── تقييم الشروط ─────────────────────────────────────────────────
function evalSignal(stochResults, dmaResults, cfg, closes) {
  // SMA50 للسعر الحالي
  const sma50 = closes && closes.length >= 50
    ? closes.slice(-50).reduce((a,b)=>a+b)/50
    : null;
  const price = closes && closes.length ? closes[closes.length-1] : null;
  const aboveSMA50 = sma50 !== null && price !== null && price > sma50;

  const stochTFs = [
    { active: cfg.stochDaily,   mode: cfg.stochDailyMode,   data: stochResults.daily,
      osKey: cfg.stochDailyOS,  osLvl: cfg.stochDailyOSLevel,  sma50: cfg.stochDailySMA50  },
    { active: cfg.stochWeekly,  mode: cfg.stochWeeklyMode,  data: stochResults.weekly,
      osKey: cfg.stochWeeklyOS, osLvl: cfg.stochWeeklyOSLevel, sma50: cfg.stochWeeklySMA50 },
    { active: cfg.stochMonthly, mode: cfg.stochMonthlyMode, data: stochResults.monthly,
      osKey: cfg.stochMonthlyOS,osLvl: cfg.stochMonthlyOSLevel,sma50: cfg.stochMonthlySMA50},
  ].filter(t => t.active && t.data);

  const stochOk = stochTFs.length === 0 || stochTFs.every(t => {
    const { k, d, kPrev, crossedLastBar, kAbovePrev } = t.data;
    let ok = t.mode === "يعبر الآن" ? crossedLastBar : (k > d && kAbovePrev);
    if (t.osKey  && ok) ok = kPrev < (t.osLvl ?? 20);
    if (t.sma50  && ok) ok = aboveSMA50;
    return ok;
  });

  const dmaTFs = [
    { active: cfg.dmaDaily,   mode: cfg.dmaDailyMode,   data: dmaResults.daily,
      zero: cfg.dmaDailyZero,  sma50: cfg.dmaDailySMA50   },
    { active: cfg.dmaWeekly,  mode: cfg.dmaWeeklyMode,  data: dmaResults.weekly,
      zero: cfg.dmaWeeklyZero, sma50: cfg.dmaWeeklySMA50  },
    { active: cfg.dmaMonthly, mode: cfg.dmaMonthlyMode, data: dmaResults.monthly,
      zero: cfg.dmaMonthlyZero,sma50: cfg.dmaMonthlySMA50 },
  ].filter(t => t.active && t.data);

  const dmaOk = dmaTFs.length === 0 || dmaTFs.every(t => {
    const { dif, difma, crossedLastBar, difAbovePrev } = t.data;
    let ok = t.mode === "يعبر الآن" ? crossedLastBar : (dif > difma && difAbovePrev);
    if (t.zero  && ok) ok = dif > 0;
    if (t.sma50 && ok) ok = aboveSMA50;
    return ok;
  });

  const ls = stochResults.daily || stochResults.weekly || stochResults.monthly || {};
  const ld = dmaResults.daily   || dmaResults.weekly   || dmaResults.monthly   || {};

  return { pass: stochOk && dmaOk, k: ls.k, d: ls.d, dif: ld.dif, difma: ld.difma };
}
