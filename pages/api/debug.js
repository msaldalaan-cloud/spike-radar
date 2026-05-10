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

    if (sorted.length < 10)
      return res.status(200).json({ error: "بيانات غير كافية", count: sorted.length });

    const closes = sorted.map(c=>+c.close);
    const highs  = sorted.map(c=>+c.high);
    const lows   = sorted.map(c=>+c.low);
    const dates  = sorted.map(c=>c.date);

    // Stoch 5,3,3 — نحسب لكل شمعة
    const rawKs=[];
    for(let i=4;i<closes.length;i++){
      let hh=highs[i],ll=lows[i];
      for(let j=i-4;j<=i;j++){hh=Math.max(hh,highs[j]);ll=Math.min(ll,lows[j]);}
      rawKs.push(hh===ll?50:((closes[i]-ll)/(hh-ll))*100);
    }
    const kArr=[];
    for(let i=2;i<rawKs.length;i++) kArr.push((rawKs[i]+rawKs[i-1]+rawKs[i-2])/3);
    const dArr=[];
    for(let i=2;i<kArr.length;i++) dArr.push((kArr[i]+kArr[i-1]+kArr[i-2])/3);

    // آخر 10 قيم مع التاريخ
    const offset = closes.length - dArr.length; // فرق الفهرس
    const last10 = dArr.slice(-10).map((d,i) => {
      const idx = dArr.length - 10 + i;
      const k   = kArr[idx];
      const kPrev = kArr[idx-1];
      const dPrev = dArr[idx-1];
      const dateIdx = idx + offset + 4 + 2; // تعويض rawKs و smooth و dPeriod
      return {
        date:  dates[Math.min(dateIdx, dates.length-1)],
        k:     +k.toFixed(2),
        d:     +d.toFixed(2),
        cross: kPrev !== undefined && kPrev < dPrev && k > d ? "🔴 CROSS" : k > d ? "🔵 ABOVE" : "⬇ BELOW"
      };
    });

    return res.status(200).json({
      symbol, interval,
      total_candles: sorted.length,
      last_date: sorted[sorted.length-1]?.date,
      last10_kd: last10,
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
