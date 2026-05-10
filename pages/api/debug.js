const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  try {
    const symbol   = req.query.symbol   || "8100";
    const interval = req.query.interval || "1d";
    const sahmkKey = process.env.SAHMK_API_KEY;

    const to   = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 400*24*60*60*1000).toISOString().split("T")[0];
    const url  = `${BASE}/historical/${symbol}/?interval=${interval}&from=${from}&to=${to}`;
    const r    = await fetch(url, { headers: { "X-API-Key": sahmkKey } });
    const json = await r.json();
    const candles = json.data || [];
    const sorted  = [...candles].sort((a,b) => new Date(a.date)-new Date(b.date));

    const closes = sorted.map(c=>+c.close);
    const highs  = sorted.map(c=>+c.high);
    const lows   = sorted.map(c=>+c.low);

    // ── طريقة TradingView الدقيقة ──
    // Step 1: Raw %K = (Close - LowestLow(5)) / (HighestHigh(5) - LowestLow(5)) * 100
    // Step 2: %K = SMA(Raw%K, 3)  ← الـ smooth
    // Step 3: %D = SMA(%K, 3)

    // Step 1: Raw K
    const rawK = [];
    for (let i = 4; i < closes.length; i++) {
      let hh = highs[i], ll = lows[i];
      for (let j = i-4; j <= i; j++) {
        if (highs[j] > hh) hh = highs[j];
        if (lows[j]  < ll) ll = lows[j];
      }
      rawK.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
    }

    // Step 2: %K = SMA(rawK, 3)
    const K = [];
    for (let i = 2; i < rawK.length; i++) {
      K.push((rawK[i] + rawK[i-1] + rawK[i-2]) / 3);
    }

    // Step 3: %D = SMA(K, 3)
    const D = [];
    for (let i = 2; i < K.length; i++) {
      D.push((K[i] + K[i-1] + K[i-2]) / 3);
    }

    const k     = K[K.length-1];
    const kPrev = K[K.length-2];
    const d     = D[D.length-1];
    const dPrev = D[D.length-2];

    const crossedLastBar = kPrev < dPrev && k > d;
    const kAbovePrev     = kPrev > dPrev;

    // آخر 5 قيم مع تاريخ تقريبي
    const last5 = D.slice(-5).map((d, i) => ({
      k: +K[K.length-5+i].toFixed(3),
      d: +d.toFixed(3),
      cross: (K[K.length-6+i] < D[D.length-6+i] && K[K.length-5+i] > d) ? "CROSS" : K[K.length-5+i] > d ? "ABOVE" : "BELOW"
    }));

    return res.status(200).json({
      symbol, interval,
      total_candles: sorted.length,
      last_date: sorted[sorted.length-1]?.date,
      // هذا ما يجب أن يطابق TradingView
      k:    +k.toFixed(3),
      d:    +d.toFixed(3),
      kPrev:+kPrev.toFixed(3),
      dPrev:+dPrev.toFixed(3),
      crossedLastBar,
      kAbovePrev,
      status: crossedLastBar ? "يعبر الآن" : (k>d && kAbovePrev) ? "فوق" : "تحت",
      // TradingView يعطي: K=63.274, D=48.987
      tradingview_target: { k: 63.274, d: 48.987 },
      last5
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
