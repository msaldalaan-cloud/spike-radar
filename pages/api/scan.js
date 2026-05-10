// pages/api/scan.js — v3.1 — filter 1-8xxx, sort fix, crossedLastBar

const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  // GET للتحقق من الإصدار
  if (req.method === "GET")
    return res.status(200).json({ version: "3.1", filter: "1-8xxx-sort-crossedLastBar" });

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

    // فلترة أسهم TASI الحقيقية — تبدأ بـ 1-8 وليس 0
    const validStocks = stocks.filter(s =>
      s.symbol &&
      /^[1-8]\d{3}$/.test(s.symbol) // 4 أرقام تبدأ بـ 1-8
    );

    for (const stock of validStocks) {
      const symbol = stock.symbol;

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
  const candles = json.results || json.data || json.candles || [];
  if (candles.length < 10) return null;

  // الأقدم أولاً — نرتب صراحةً بالتاريخ
  const sorted = [...candles].sort((a, b) => {
    const da = new Date(a.date || a.datetime || a.timestamp || 0);
    const db = new Date(b.date || b.datetime || b.timestamp || 0);
    if (isNaN(da) || isNaN(db)) return 0;
    return da - db; // تصاعدي: الأقدم أولاً
  });

  // تحقق: آخر شمعة يجب أن تكون الأحدث
  if (sorted.length < 10) return null;

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

  // نحفظ آخر 3 قيم لضمان دقة تحديد التقاطع
  const k      = kArr[kArr.length - 1];
  const kPrev  = kArr[kArr.length - 2];
  const kPrev2 = kArr[kArr.length - 3];
  const d      = dArr[dArr.length - 1];
  const dPrev  = dArr[dArr.length - 2];
  const dPrev2 = dArr[dArr.length - 3];

  // هل التقاطع حصل على الشمعة الأخيرة فعلاً؟
  // يعبر الآن = الشمعة الأخيرة هي نقطة التقاطع
  // فوق = K فوق D، لكن التقاطع حصل في شمعة سابقة
  const crossedLastBar  = kPrev  !== undefined && dPrev  !== undefined && kPrev  < dPrev  && k > d;
  const crossedPrevBar  = kPrev2 !== undefined && dPrev2 !== undefined && kPrev2 < dPrev2 && kPrev > dPrev;

  return { k, kPrev, kPrev2, d, dPrev, dPrev2, crossedLastBar };
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
  const dif       = difArr[difArr.length - 1];
  const difPrev   = difArr[difArr.length - 2];

  // هل التقاطع حصل على الشمعة الأخيرة؟
  const crossedLastBar = difPrev !== undefined && difmaPrev !== null &&
    difPrev < difmaPrev && dif > difma;

  return { dif, difPrev, difma, difmaPrev, crossedLastBar };
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
    const { k, d, kPrev, dPrev, crossedLastBar } = t.data;
    let ok;
    if (t.mode === "يعبر الآن") {
      // التقاطع يجب أن يكون على الشمعة الأخيرة تحديداً
      ok = crossedLastBar === true;
    } else {
      // فوق = K فوق D بغض النظر متى حصل التقاطع
      ok = k > d && !crossedLastBar;
    }
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
    const { dif, difma, crossedLastBar } = t.data;
    let ok;
    if (t.mode === "يعبر الآن") {
      ok = crossedLastBar === true;
    } else {
      ok = dif > difma && !crossedLastBar;
    }
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
