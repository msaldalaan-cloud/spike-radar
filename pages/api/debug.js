const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  try {
    const symbol   = req.query.symbol || "8100";
    const period   = req.query.period  || "daily";
    const sahmkKey = process.env.SAHMK_API_KEY;

    const r    = await fetch(`${BASE}/historical/${symbol}/?period=${period}&limit=300`,
      { headers: { "X-API-Key": sahmkKey } });
    const json = await r.json();
    const candles = json.data || json.results || [];
    const sorted  = [...candles].sort((a,b) => new Date(a.date)-new Date(b.date));

    if (sorted.length < 5)
      return res.status(200).json({ error: "بيانات غير كافية", count: sorted.length, keys: Object.keys(json) });

    const closes = sorted.map(c => +c.close);
    const highs  = sorted.map(c => +c.high);
    const lows   = sorted.map(c => +c.low);

    // Stoch 5,3,3
    const rawKs = [];
    for (let i = 4; i < closes.length; i++) {
      let hh = highs[i], ll = lows[i];
      for (let j = i-4; j <= i; j++) { hh = Math.max(hh,highs[j]); ll = Math.min(ll,lows[j]); }
      rawKs.push(hh===ll ? 50 : ((closes[i]-ll)/(hh-ll))*100);
    }
    const kArr = [];
    for (let i = 2; i < rawKs.length; i++) kArr.push((rawKs[i]+rawKs[i-1]+rawKs[i-2])/3);
    const dArr = [];
    for (let i = 2; i < kArr.length; i++) dArr.push((kArr[i]+kArr[i-1]+kArr[i-2])/3);

    const k=kArr[kArr.length-1], kPrev=kArr[kArr.length-2];
    const d=dArr[dArr.length-1], dPrev=dArr[dArr.length-2];
    const crossedLastBar = kPrev < dPrev && k > d;
    const kAbovePrev     = kPrev > dPrev;

    // DMA 10,50,10
    let dmaStatus = "بيانات غير كافية";
    if (closes.length >= 60) {
      const difArr = [];
      for (let i = 49; i < closes.length; i++) {
        const sF = closes.slice(i-9,i+1).reduce((a,b)=>a+b)/10;
        const sS = closes.slice(i-49,i+1).reduce((a,b)=>a+b)/50;
        difArr.push(sF-sS);
      }
      const k2 = 2/11;
      let difma = difArr.slice(0,10).reduce((a,b)=>a+b)/10;
      for (let i=10;i<difArr.length;i++) difma = difArr[i]*k2 + difma*(1-k2);
      let difmaPrev = difArr.slice(0,9).reduce((a,b)=>a+b)/9; // تقريبي
      const dif = difArr[difArr.length-1];
      const difPrev = difArr[difArr.length-2];
      const dmaCrossed = difPrev < difmaPrev && dif > difma;
      const dmaAbove   = dif > difma && !dmaCrossed;
      dmaStatus = dmaCrossed ? "يعبر الآن" : dmaAbove ? "فوق" : "تحت";
    }

    return res.status(200).json({
      symbol, period,
      total_candles: sorted.length,
      first_date: sorted[0]?.date,
      last_date:  sorted[sorted.length-1]?.date,
      last5: sorted.slice(-5).map(c=>({date:c.date, close:c.close})),
      stoch: {
        k:+k.toFixed(2), kPrev:+kPrev.toFixed(2),
        d:+d.toFixed(2),  dPrev:+dPrev.toFixed(2),
        crossedLastBar, kAbovePrev,
        status: crossedLastBar ? "يعبر الآن" : (k>d&&kAbovePrev) ? "فوق" : "تحت"
      },
      dma: dmaStatus
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
