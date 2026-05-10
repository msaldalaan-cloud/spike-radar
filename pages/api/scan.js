// pages/api/scan.js

const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { cfg } = req.body;
  const sahmkKey = process.env.SAHMK_API_KEY;

  if (!sahmkKey)
    return res.status(500).json({ error: "SAHMK_API_KEY غير موجود في Environment Variables" });

  try {
    // ── 1. جلب قائمة الأسهم ──────────────────────────────────
    const listRes = await fetch(`${BASE}/companies/?market=TASI&limit=500`, {
      headers: { "X-API-Key": sahmkKey },
    });
    if (!listRes.ok) {
      const err = await listRes.text();
      return res.status(500).json({ error: `فشل جلب الأسهم: ${listRes.status} — ${err}` });
    }
    const listData = await listRes.json();
    const stocks   = listData.results || [];

    if (!stocks.length)
      return res.status(200).json({ results: [], scannedAt: new Date().toISOString() });

    const results = [];

    for (const stock of stocks) {
      const symbol = stock.symbol;
      if (!symbol) continue;

      try {
        // ── 2. جلب OHLC لكل فاصل مفعّل ────────────────────
        const stochResults = {}, dmaResults = {};

        for (const [key, cfgKey, interval] of [
          ["daily",   "stochDaily",   "1d"],
          ["weekly",  "stochWeekly",  "1w"],
          ["monthly", "stochMonthly", "1M"],
        ]) {
          if (!cfg[cfgKey]) continue;
          const data = await fetchOHLC(sahmkKey, symbol, interval, 120);
          if (data) stochResults[key] = calcStoch(data.closes, data.highs, data.lows, 5, 3, 3);
        }

        for (const [key, cfgKey, interval] of [
          ["daily",   "dmaDaily",   "1d"],
          ["weekly",  "dmaWeekly",  "1w"],
          ["monthly", "dmaMonthly", "1M"],
        ]) {
          if (!cfg[cfgKey]) continue;
          // تجنب إعادة الجلب إذا نفس البيانات محسوبة في stoch
          const existing = stochResults[key];
          if (existing && cfg[`stoch${key.charAt(0).toUpperCase()+key.slice(1)}`]) {
            // أعد جلب لأن DMA يحتاج closes فقط
          }
          const data = await fetchOHLC(sahmkKey, symbol, interval, 120);
          if (data) dmaResults[key] = calcDMA(data.closes, 10, 50, 10);
        }

        // ── 3. تقييم الشروط ──────────────────────────────────
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

      } catch (e) {
        // تجاهل الأسهم التي فشل حسابها
        continue;
      }
    }

    return res.status(200).json({ results, scannedAt: new Date().toISOString() });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ── جلب OHLC من Sahmk ────────────────────────────────────────────
async function fetchOHLC(apiKey, symbol, interval, limit = 120) {
  // تحويل interval لصيغة Sahmk
  const periodMap = { "1d": "daily", "1w": "weekly", "1M": "monthly" };
  const period    = periodMap[interval] || "daily";

  const url = `${BASE}/historical/${symbol}/?period=${period}&limit=${limit}`;
  const r   = await fetch(url, { headers: { "X-API-Key": apiKey } });
  if (!r.ok) return null;

  const json    = await r.json();
  // Sahmk يرجع: { results: [{date, open, high, low, close, volume}] }
  const candles = json.results || json.data || [];
  if (candles.length < 10) return null;

  // الأقدم أولاً
  const sorted = [...candles].sort((a, b) => new Date(a.date) - new Date(b.date));

  return {
    closes: sorted.map(c => +c.close),
    highs:  sorted.map(c => +c.high),
    lows:   sorted.map(c => +c.low),
  };
}

// ── Stochastic 5,3,3 ─────────────────────────────────────────────
function calcStoch(closes, highs, lows, kPeriod, smooth, dPeriod) {
  const rawKs = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    rawKs.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  const kArr = [];
  for (let i = smooth - 1; i < rawKs.length; i++)
    kArr.push(rawKs.slice(i - smooth + 1, i + 1).reduce((a, b) => a + b) / smooth);
  const dArr = [];
  for (let i = dPeriod - 1; i < kArr.length; i++)
    dArr.push(kArr.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b) / dPeriod);
  return {
    k:     kArr[kArr.length - 1],
    kPrev: kArr[kArr.length - 2],
    d:     dArr[dArr.length - 1],
    dPrev: dArr[dArr.length - 2],
  };
}

// ── DMA 10,50,10 ─────────────────────────────────────────────────
function calcDMA(closes, fast, slow, signal) {
  if (closes.length < slow + signal) return null;
  const difArr = [];
  for (let i = slow - 1; i < closes.length; i++) {
    const sF = closes.slice(i - fast + 1, i + 1).reduce((a, b) => a + b) / fast;
    const sS = closes.slice(i - slow + 1, i + 1).reduce((a, b) => a + b) / slow;
    difArr.push(sF - sS);
  }
  const difma     = ema(difArr, signal);
  const difmaPrev = ema(difArr.slice(0, -1), signal);
  return {
    dif:      difArr[difArr.length - 1],
    difPrev:  difArr[difArr.length - 2],
    difma,
    difmaPrev,
  };
}

function ema(arr, period) {
  if (!arr || arr.length < period) return null;
  const k = 2 / (period + 1);
  let v   = arr.slice(0, period).reduce((a, b) => a + b) / period;
  for (let i = period; i < arr.length; i++) v = arr[i] * k + v * (1 - k);
  return v;
}

// ── تقييم الشروط — كل فاصل مستقل ────────────────────────────────
function evalSignal(stochResults, dmaResults, cfg) {
  const crosses = (a, b, ap, bp) =>
    a != null && b != null && ap != null && bp != null && ap < bp && a > b;
  const above = (a, b, ap, bp) =>
    a != null && b != null && a > b && !crosses(a, b, ap, bp);

  const stochTFs = [
    { active: cfg.stochDaily,   mode: cfg.stochDailyMode,   data: stochResults.daily   },
    { active: cfg.stochWeekly,  mode: cfg.stochWeeklyMode,  data: stochResults.weekly  },
    { active: cfg.stochMonthly, mode: cfg.stochMonthlyMode, data: stochResults.monthly },
  ].filter(t => t.active && t.data);

  const stochOk = stochTFs.length === 0 || stochTFs.every(t => {
    const { k, d, kPrev, dPrev } = t.data;
    let ok = t.mode === "يعبر الآن"
      ? crosses(k, d, kPrev, dPrev)
      : above(k, d, kPrev, dPrev);
    if (cfg.stochOS  && ok) ok = kPrev < cfg.stochOSLevel;
    if (cfg.stochMid && ok) ok = k > 50;
    return ok;
  });

  const dmaTFs = [
    { active: cfg.dmaDaily,   mode: cfg.dmaDailyMode,   data: dmaResults.daily   },
    { active: cfg.dmaWeekly,  mode: cfg.dmaWeeklyMode,  data: dmaResults.weekly  },
    { active: cfg.dmaMonthly, mode: cfg.dmaMonthlyMode, data: dmaResults.monthly },
  ].filter(t => t.active && t.data);

  const dmaOk = dmaTFs.length === 0 || dmaTFs.every(t => {
    const { dif, difma, difPrev, difmaPrev } = t.data;
    let ok = t.mode === "يعبر الآن"
      ? crosses(dif, difma, difPrev, difmaPrev)
      : above(dif, difma, difPrev, difmaPrev);
    if (cfg.dmaZero && ok) ok = dif > 0;
    return ok;
  });

  const lastStoch = stochResults.daily || stochResults.weekly || stochResults.monthly || {};
  const lastDma   = dmaResults.daily   || dmaResults.weekly   || dmaResults.monthly   || {};

  return {
    pass:  stochOk && dmaOk,
    k:     lastStoch.k,
    d:     lastStoch.d,
    dif:   lastDma.dif,
    difma: lastDma.difma,
  };
}
