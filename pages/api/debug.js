// pages/api/debug.js — مؤقت لفحص بيانات سهم + حساب Stoch

const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  const symbol   = req.query.symbol || "8100";
  const sahmkKey = process.env.SAHMK_API_KEY;

  const r    = await fetch(`${BASE}/historical/${symbol}/?period=daily&limit=300`,
    { headers: { "X-API-Key": sahmkKey } });
  const json = await r.json();
  const candles = json.results || json.data || json.candles || [];

  const sorted = [...candles].sort((a, b) =>
    new Date(a.date || 0) - new Date(b.date || 0)
  );

  const closes = sorted.map(c => +c.close);
  const highs  = sorted.map(c => +c.high);
  const lows   = sorted.map(c => +c.low);

  // حساب Stoch 5,3,3
  const rawKs = [];
  for (let i = 4; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i-4, i+1));
    const ll = Math.min(...lows.slice(i-4, i+1));
    rawKs.push(hh===ll ? 50 : ((closes[i]-ll)/(hh-ll))*100);
  }
  const kArr = [];
  for (let i = 2; i < rawKs.length; i++)
    kArr.push((rawKs[i]+rawKs[i-1]+rawKs[i-2])/3);
  const dArr = [];
  for (let i = 2; i < kArr.length; i++)
    dArr.push((kArr[i]+kArr[i-1]+kArr[i-2])/3);

  const k     = kArr[kArr.length-1];
  const kPrev = kArr[kArr.length-2];
  const d     = dArr[dArr.length-1];
  const dPrev = dArr[dArr.length-2];
  const crossedLastBar = kPrev < dPrev && k > d;

  // آخر 5 أيام
  const last5 = sorted.slice(-5).map(c => ({
    date: c.date, close: c.close
  }));

  return res.status(200).json({
    symbol,
    total_candles: sorted.length,
    last_date:     sorted[sorted.length-1]?.date,
    days_old:      Math.round((Date.now()-new Date(sorted[sorted.length-1]?.date))/(86400000)),
    last5,
    stoch: {
      k: +k.toFixed(2), kPrev: +kPrev.toFixed(2),
      d: +d.toFixed(2), dPrev: +dPrev.toFixed(2),
      crossedLastBar,
      status: crossedLastBar ? "يعبر الآن" : k > d ? "فوق" : "تحت"
    }
  });
}
