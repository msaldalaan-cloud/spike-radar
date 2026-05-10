const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  try {
    const symbol   = req.query.symbol   || "2286";
    const interval = req.query.interval || "1w";
    const sahmkKey = process.env.SAHMK_API_KEY;

    const to   = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 730*24*60*60*1000).toISOString().split("T")[0];
    const url  = `${BASE}/historical/${symbol}/?interval=${interval}&from=${from}&to=${to}`;
    const r    = await fetch(url, { headers: { "X-API-Key": sahmkKey } });
    const json = await r.json();
    const sorted = [...(json.data||[])].sort((a,b)=>new Date(a.date)-new Date(b.date));

    const closes = sorted.map(c=>+c.close);
    const highs  = sorted.map(c=>+c.high);
    const lows   = sorted.map(c=>+c.low);

    // Raw K(5)
    const rawK = [];
    for (let i = 4; i < closes.length; i++) {
      let hh=highs[i], ll=lows[i];
      for (let j=i-4;j<=i;j++){if(highs[j]>hh)hh=highs[j];if(lows[j]<ll)ll=lows[j];}
      rawK.push(hh===ll?50:((closes[i]-ll)/(hh-ll))*100);
    }

    // K = SMA(rawK, 3)
    const K = [];
    for (let i = 2; i < rawK.length; i++) {
      K.push((rawK[i]+rawK[i-1]+rawK[i-2])/3);
    }

    // D = SMA(K, 3)
    const D = [];
    for (let i = 2; i < K.length; i++) {
      D.push((K[i]+K[i-1]+K[i-2])/3);
    }

    const k     = K[K.length-1];
    const kPrev = K[K.length-2];
    const d     = D[D.length-1];
    const dPrev = D[D.length-2];

    // آخر 5 شمعات مع K و D
    const last5 = [];
    for (let i = Math.max(0, D.length-5); i < D.length; i++) {
      const ki = K.length - D.length + i;
      last5.push({
        date: sorted[i + (sorted.length - D.length)]?.date,
        k: +K[ki].toFixed(2),
        d: +D[i].toFixed(2),
        status: K[ki] > D[i] ? "K فوق D" : "D فوق K"
      });
    }

    return res.status(200).json({
      symbol, interval, url,
      total_candles: sorted.length,
      last_date: sorted[sorted.length-1]?.date,
      k: +k.toFixed(3), d: +d.toFixed(3),
      kPrev: +kPrev.toFixed(3), dPrev: +dPrev.toFixed(3),
      kAboveD: k > d,
      tradingview: { k: 67.43, d: 58.52, kAboveD: false },
      last5
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
