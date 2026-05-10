const BASE = "https://app.sahmk.sa/api/v1";

function aggregateCandles(daily, interval) {
  const groups = {};
  for (const c of daily) {
    const d = new Date(c.date);
    let key;
    if (interval === "1w") {
      const sunday = new Date(d);
      sunday.setDate(d.getDate() - d.getDay());
      key = sunday.toISOString().split("T")[0];
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    }
    if (!groups[key]) {
      groups[key] = { open:+c.open, high:+c.high, low:+c.low, close:+c.close, date:c.date };
    } else {
      groups[key].high  = Math.max(groups[key].high, +c.high);
      groups[key].low   = Math.min(groups[key].low,  +c.low);
      groups[key].close = +c.close;
    }
  }
  const keys  = Object.keys(groups).sort();
  const today = new Date();
  const todayKey = interval === "1w"
    ? (() => { const d=new Date(today); d.setDate(d.getDate()-d.getDay()); return d.toISOString().split("T")[0]; })()
    : `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
  // نُبقي الأسبوع الحالي (الشمعة الحية)
  return keys.map(k => groups[k]);
}

export default async function handler(req, res) {
  try {
    const symbol   = req.query.symbol   || "2286";
    const interval = req.query.interval || "1w";
    const sahmkKey = process.env.SAHMK_API_KEY;

    const to   = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 730*24*60*60*1000).toISOString().split("T")[0];
    const r    = await fetch(`${BASE}/historical/${symbol}/?interval=1d&from=${from}&to=${to}`,
      { headers: { "X-API-Key": sahmkKey } });
    const json = await r.json();
    const daily  = [...(json.data||[])].sort((a,b)=>new Date(a.date)-new Date(b.date));
    const candles = interval === "1d" ? daily : aggregateCandles(daily, interval);

    const closes = candles.map(c=>+c.close);
    const highs  = candles.map(c=>+c.high);
    const lows   = candles.map(c=>+c.low);

    const rawK=[];
    for(let i=4;i<closes.length;i++){
      let hh=highs[i],ll=lows[i];
      for(let j=i-4;j<=i;j++){if(highs[j]>hh)hh=highs[j];if(lows[j]<ll)ll=lows[j];}
      rawK.push(hh===ll?50:((closes[i]-ll)/(hh-ll))*100);
    }
    const K=[];
    for(let i=2;i<rawK.length;i++) K.push((rawK[i]+rawK[i-1]+rawK[i-2])/3);
    const D=[];
    for(let i=2;i<K.length;i++) D.push((K[i]+K[i-1]+K[i-2])/3);

    // K أطول من D بـ 2 — نأخذ K المقابلة لآخر D
    const n=D.length-1;
    const d=D[n], dPrev=D[n-1];
    const k=K[n+2], kPrev=K[n+1];

    const last5 = D.slice(-5).map((dv,i)=>({
      week: candles[candles.length - D.length + D.length-5+i]?.date,
      k: +K[D.length-5+i+2].toFixed(2),
      d: +dv.toFixed(2),
      status: K[D.length-5+i+2] > dv ? "K فوق D ✅" : "D فوق K ❌"
    }));

    return res.status(200).json({
      symbol, interval,
      total_candles: candles.length,
      last_week: candles[candles.length-1]?.date,
      k:+k.toFixed(2), d:+d.toFixed(2),
      kAboveD: k > d,
      tradingview: { k:73.44, d:66.48, kAboveD: true, note:"شمعة 3-7 مايو المغلقة" },
      last5
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
