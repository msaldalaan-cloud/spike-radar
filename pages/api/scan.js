// pages/api/scan.js
// فحص يدوي — يستدعى من الواجهة

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { cfg } = req.body;
  const sahmkKey = process.env.SAHMK_API_KEY;

  if (!sahmkKey)
    return res.status(500).json({ error: "SAHMK_API_KEY غير موجود في Environment Variables" });

  try {
    // ── 1. جلب قائمة الأسهم من Sahmk ──────────────────────────
    const listRes = await fetch("https://api.sahmk.com/v1/stocks", {
      headers: { Authorization: `Bearer ${sahmkKey}` },
    });
    if (!listRes.ok) return res.status(500).json({ error: "فشل جلب قائمة الأسهم من Sahmk" });
    const listData = await listRes.json();
    const stocks = listData.data || listData.stocks || [];

    // ── 2. تحديد الـ interval بناءً على الإعدادات ──────────────
    const tfMap = { daily: "1d", weekly: "1w", monthly: "1M" };
    const stochInterval = tfMap[cfg.stochTF] || "1d";
    const dmaInterval   = tfMap[cfg.dmaTF]   || "1d";
    const needSame      = stochInterval === dmaInterval;

    const results = [];

    for (const stock of stocks) {
      const symbol = stock.symbol || stock.ticker;
      if (!symbol) continue;

      try {
        // جلب بيانات Stochastic
        const stochData = await fetchOHLC(sahmkKey, symbol, stochInterval, 120);
        if (!stochData || stochData.closes.length < 60) continue;

        // جلب بيانات DMA (نفس الطلب إذا نفس الـ TF)
        const dmaData = needSame ? stochData : await fetchOHLC(sahmkKey, symbol, dmaInterval, 120);
        if (!dmaData || dmaData.closes.length < 60) continue;

        // ── حساب Stochastic ──────────────────────────────────
        const stoch = calcStoch(
          stochData.closes, stochData.highs, stochData.lows,
          5, 3, 3
        );

        // ── حساب DMA ─────────────────────────────────────────
        const dma = calcDMA(dmaData.closes, 10, 50, 10);

        // ── تقييم الشروط ──────────────────────────────────────
        const { pass, ...vals } = evalSignal(stoch, dma, cfg);

        results.push({
          symbol,
          name: stock.name || stock.company_name || symbol,
          pass,
          k:    +stoch.k?.toFixed(2),
          d:    +stoch.d?.toFixed(2),
          dif:  +dma.dif?.toFixed(4),
          difma:+dma.difma?.toFixed(4),
        });

      } catch (e) {
        // تجاهل الأسهم التي فشل جلب بياناتها
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
  const url = `https://api.sahmk.com/v1/history?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!r.ok) return null;
  const json = await r.json();
  const candles = json.data || json.candles || [];
  if (!candles.length) return null;
  return {
    closes: candles.map(c => +c.close),
    highs:  candles.map(c => +c.high),
    lows:   candles.map(c => +c.low),
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
  if (arr.length < period) return null;
  const k = 2 / (period + 1);
  let v = arr.slice(0, period).reduce((a, b) => a + b) / period;
  for (let i = period; i < arr.length; i++) v = arr[i] * k + v * (1 - k);
  return v;
}

// ── تقييم الشروط ─────────────────────────────────────────────────
function evalSignal(stoch, dma, cfg) {
  const { k, d, kPrev, dPrev } = stoch;
  const { dif, difma, difPrev, difmaPrev } = dma;

  const crosses = (a, b, ap, bp) => ap !== undefined && bp !== undefined && ap < bp && a > b;
  const above   = (a, b, ap, bp) => a > b && !crosses(a, b, ap, bp);

  let stochOk = cfg.stochMode === "يعبر الآن"
    ? crosses(k, d, kPrev, dPrev)
    : above(k, d, kPrev, dPrev);

  if (cfg.stochOS  && stochOk) stochOk = kPrev < cfg.stochOSLevel;
  if (cfg.stochMid && stochOk) stochOk = k > 50;

  let dmaOk = cfg.dmaMode === "يعبر الآن"
    ? crosses(dif, difma, difPrev, difmaPrev)
    : above(dif, difma, difPrev, difmaPrev);

  if (cfg.dmaZero  && dmaOk) dmaOk = dif > 0;
  if (cfg.dmaSMA50 && dmaOk) dmaOk = true; // يُحسب في fetchOHLC إذا احتجت

  return { pass: stochOk && dmaOk };
}
