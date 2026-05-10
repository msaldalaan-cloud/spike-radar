const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  try {
    const symbol   = req.query.symbol || "8100";
    const sahmkKey = process.env.SAHMK_API_KEY;

    const r    = await fetch(`${BASE}/historical/${symbol}/?period=daily&limit=300`,
      { headers: { "X-API-Key": sahmkKey } });
    const json = await r.json();

    // البيانات في json.data
    const candles = json.data || json.results || [];
    const sorted  = [...candles].sort((a,b) => new Date(a.date)-new Date(b.date));
    const closes  = sorted.map(c => +c.close);
    const highs   = sorted.map(c => +c.high);
    const lows    = sorted.map(c => +c.low);

    if (sorted.length < 10)
      return res.status(200).json({ error: "بيانات غير كافية", count: sorted.length, raw_keys: Object.keys(json) });

    // Stoch 5,3,3
    const rawKs = [];
    for (let i = 4; i < closes.length; i++) {
      let hh = highs[i], ll = lows[i];
      for (let j = i-4; j <= i; j++) { hh = Math.max(hh, highs[j]); ll = Math.min(ll, lows[j]); }
      rawKs.push(hh === ll ? 50 : ((closes[i]-ll)/(hh-ll))*100);
    }
    const kArr = [];
    for (let i = 2; i < rawKs.length; i++) kArr.push((rawKs[i]+rawKs[i-1]+rawKs[i-2])/3);
    const dArr = [];
    for (let i = 2; i < kArr.length; i++) dArr.push((kArr[i]+kArr[i-1]+kArr[i-2])/3);

    const k      = kArr[kArr.length-1];
    const kPrev  = kArr[kArr.length-2];
    const d      = dArr[dArr.length-1];
    const dPrev  = dArr[dArr.length-2];

    const crossedLastBar = kPrev < dPrev && k > d;
    const kAbovePrev     = kPrev > dPrev;

    return res.status(200).json({
      symbol,
      total_candles: sorted.length,
      last_date:     sorted[sorted.length-1]?.date,
      last5: sorted.slice(-5).map(c => ({ date: c.date, close: c.close })),
      stoch: {
        k: +k.toFixed(2), kPrev: +kPrev.toFixed(2),
        d: +d.toFixed(2), dPrev: +dPrev.toFixed(2),
        crossedLastBar,
        kAbovePrev,
        status_cross: crossedLastBar ? "✅ يعبر الآن" : "❌ لا",
        status_above: (!crossedLastBar && k > d && kAbovePrev) ? "✅ فوق" : "❌ لا",
      }
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
