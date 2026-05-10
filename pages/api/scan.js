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
    // GET /companies/?market=TASI&limit=500
    const listRes = await fetch(`${BASE}/companies/?market=TASI&limit=500`, {
      headers: { "X-API-Key": sahmkKey },
    });
    if (!listRes.ok) return res.status(500).json({ error: `فشل جلب الأسهم: ${listRes.status}` });

    const listData = await listRes.json();
    // يرجع: { results: [{symbol, name_ar, name_en, market, status}], count, total }
    const stocks = (listData.results || []).filter(s =>
      s.symbol &&
      /^[1-9]\d{3}$/.test(s.symbol) && // 4 أرقام تبدأ بـ 1-9
      s.market === "TASI" &&
      s.status === "active"
    );

    if (!stocks.length)
      return res.status(200).json({ results: [], scannedAt: new Date().toISOString() });

    const results = [];

    for (const stock of stocks) {
      const symbol = stock.symbol;
      try {
        // ── 2. جلب OHLC لكل فاصل مفعّل ────────────────────
        // GET /historical/{symbol}/?interval=1d&from=...&to=...
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

        const evaluation = evalSignal(stochResults, dmaResults, cfg);

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

// ── جلب OHLC — interval: 1d / 1w / 1m ───────────────────────────
async function fetchOHLC(apiKey, symbol, interval) {
  const to   = new Date().toISOString().split("T")[0];
  // يومي: سنة كاملة (~248 شمعة) | أسبوعي: سنتان | شهري: 5 سنوات
  const days = interval === "1d" ? 400 : interval === "1w" ? 730 : 1825;
  const from = new Date(Date.now() - days*24*60*60*1000).toISOString().split("T")[0];

  // GET /historical/{symbol}/?interval=1d&from=...&to=...
  const url = `${BASE}/historical/${symbol}/?interval=${interval}&from=${from}&to=${to}`;
  const r   = await fetch(url, { headers: { "X-API-Key": apiKey } });
  if (!r.ok) return null;

  const json    = await r.json();
  // البيانات في حقل "data" حسب الوثائق الرسمية
  const candles = json.data || [];
  if (candles.length < 10) return null;

  // الأقدم أولاً (الـ API يرجع الأحدث أولاً)
  const sorted = [...candles].sort((a, b) => new Date(a.date) - new Date(b.date));

  // تحقق: آخر شمعة لا تكون أقدم من 7 أيام
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
  const rawKs = [];
  for (let i = kPeriod-1; i < closes.length; i++) {
    let hh = highs[i], ll = lows[i];
    for (let j = i-kPeriod+1; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]); }
    rawKs.push(hh === ll ? 50 : ((closes[i]-ll)/(hh-ll))*100);
  }
  const kArr = [];
  for (let i = smooth-1; i < rawKs.length; i++)
    kArr.push((rawKs[i]+rawKs[i-1]+rawKs[i-2])/smooth);
  const dArr = [];
  for (let i = dPeriod-1; i < kArr.length; i++)
    dArr.push((kArr[i]+kArr[i-1]+kArr[i-2])/dPeriod);

  const k     = kArr[kArr.length-1];
  const kPrev = kArr[kArr.length-2];
  const d     = dArr[dArr.length-1];
  const dPrev = dArr[dArr.length-2];

  // يعبر الآن: kPrev كان تحت dPrev، وk الآن فوق d
  const crossedLastBar = kPrev < dPrev && k > d;
  // فوق: k فوق d الآن، وكان فوقه في الشمعة السابقة أيضاً
  const kAbovePrev = kPrev > dPrev;

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
function evalSignal(stochResults, dmaResults, cfg) {
  const stochTFs = [
    { active: cfg.stochDaily,   mode: cfg.stochDailyMode,   data: stochResults.daily   },
    { active: cfg.stochWeekly,  mode: cfg.stochWeeklyMode,  data: stochResults.weekly  },
    { active: cfg.stochMonthly, mode: cfg.stochMonthlyMode, data: stochResults.monthly },
  ].filter(t => t.active && t.data);

  const stochOk = stochTFs.length === 0 || stochTFs.every(t => {
    const { k, d, crossedLastBar, kAbovePrev } = t.data;
    let ok = t.mode === "يعبر الآن"
      ? crossedLastBar
      : (k > d && kAbovePrev); // فوق = K فوق D الآن وفي الشمعة السابقة
    if (cfg.stochOS  && ok) ok = t.data.kPrev < cfg.stochOSLevel;
    if (cfg.stochMid && ok) ok = k > 50;
    return ok;
  });

  const dmaTFs = [
    { active: cfg.dmaDaily,   mode: cfg.dmaDailyMode,   data: dmaResults.daily   },
    { active: cfg.dmaWeekly,  mode: cfg.dmaWeeklyMode,  data: dmaResults.weekly  },
    { active: cfg.dmaMonthly, mode: cfg.dmaMonthlyMode, data: dmaResults.monthly },
  ].filter(t => t.active && t.data);

  const dmaOk = dmaTFs.length === 0 || dmaTFs.every(t => {
    const { dif, difma, crossedLastBar, difAbovePrev } = t.data;
    let ok = t.mode === "يعبر الآن"
      ? crossedLastBar
      : (dif > difma && difAbovePrev);
    if (cfg.dmaZero && ok) ok = dif > 0;
    return ok;
  });

  const ls = stochResults.daily || stochResults.weekly || stochResults.monthly || {};
  const ld = dmaResults.daily   || dmaResults.weekly   || dmaResults.monthly   || {};

  return { pass: stochOk && dmaOk, k: ls.k, d: ls.d, dif: ld.dif, difma: ld.difma };
}
