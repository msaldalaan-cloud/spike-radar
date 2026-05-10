const BASE = "https://app.sahmk.sa/api/v1";

function sma(arr, period, idx) {
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += arr[i];
  return sum / period;
}

function ema(arr, period) {
  const k = 2 / (period + 1);
  let val = arr.slice(0, period).reduce((a,b)=>a+b) / period;
  for (let i = period; i < arr.length; i++) val = arr[i]*k + val*(1-k);
  return val;
}

function emaArr(arr, period) {
  const k = 2 / (period + 1);
  const result = [];
  let val = arr.slice(0, period).reduce((a,b)=>a+b) / period;
  result.push(val);
  for (let i = period; i < arr.length; i++) {
    val = arr[i]*k + val*(1-k);
    result.push(val);
  }
  return result;
}

export default async function handler(req, res) {
  try {
    const symbol   = req.query.symbol   || "8100";
    const interval = req.query.interval || "1d";
    const sahmkKey = process.env.SAHMK_API_KEY;

    const to   = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 400*24*60*60*1000).toISOString().split("T")[0];
    const r    = await fetch(`${BASE}/historical/${symbol}/?interval=${interval}&from=${from}&to=${to}`,
      { headers: { "X-API-Key": sahmkKey } });
    const json = await r.json();
    const sorted = [...(json.data||[])].sort((a,b)=>new Date(a.date)-new Date(b.date));

    const closes = sorted.map(c=>+c.close);
    const highs  = sorted.map(c=>+c.high);
    const lows   = sorted.map(c=>+c.low);

    // Raw K(5)
    const rawK = [];
    for (let i = 4; i < closes.length; i++) {
      let hh=highs[i], ll=lows[i];
      for (let j=i-4;j<=i;j++){hh=Math.max(hh,highs[j]);ll=Math.min(ll,lows[j]);}
      rawK.push(hh===ll?50:((closes[i]-ll)/(hh-ll))*100);
    }

    // طريقة 1: SMA/SMA
    const K_sma=[], D_sma=[];
    for(let i=2;i<rawK.length;i++) K_sma.push((rawK[i]+rawK[i-1]+rawK[i-2])/3);
    for(let i=2;i<K_sma.length;i++) D_sma.push((K_sma[i]+K_sma[i-1]+K_sma[i-2])/3);

    // طريقة 2: EMA/EMA
    const K_ema = emaArr(rawK, 3);
    const D_ema = emaArr(K_ema, 3);

    // طريقة 3: SMA/EMA
    const D_sma_ema = emaArr(K_sma, 3);

    // طريقة 4: EMA/SMA
    const D_ema_sma=[];
    for(let i=2;i<K_ema.length;i++) D_ema_sma.push((K_ema[i]+K_ema[i-1]+K_ema[i-2])/3);

    return res.status(200).json({
      symbol, interval,
      total_candles: sorted.length,
      last_date: sorted[sorted.length-1]?.date,
      target: { k: 63.274, d: 48.987 },
      results: {
        "SMA/SMA":   { k: +K_sma[K_sma.length-1].toFixed(3), d: +D_sma[D_sma.length-1].toFixed(3) },
        "EMA/EMA":   { k: +K_ema[K_ema.length-1].toFixed(3), d: +D_ema[D_ema.length-1].toFixed(3) },
        "SMA/EMA":   { k: +K_sma[K_sma.length-1].toFixed(3), d: +D_sma_ema[D_sma_ema.length-1].toFixed(3) },
        "EMA/SMA":   { k: +K_ema[K_ema.length-1].toFixed(3), d: +D_ema_sma[D_ema_sma.length-1].toFixed(3) },
      }
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
