const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  const symbol   = req.query.symbol || "2287";
  const sahmkKey = process.env.SAHMK_API_KEY;

  const to   = new Date().toISOString().split("T")[0];
  const from = new Date(Date.now() - 400*24*60*60*1000).toISOString().split("T")[0];
  const r    = await fetch(`${BASE}/historical/${symbol}/?interval=1d&from=${from}&to=${to}`,
    { headers: { "X-API-Key": sahmkKey } });
  const json = await r.json();
  const sorted = [...(json.data||[])].sort((a,b)=>new Date(a.date)-new Date(b.date));

  const lastDateStr = sorted[sorted.length-1]?.date;

  // حساب تاريخ الرياض
  const nowRiyadh = new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Riyadh"}));
  const yr = nowRiyadh.getFullYear();
  const mo = String(nowRiyadh.getMonth()+1).padStart(2,"0");
  const dy = String(nowRiyadh.getDate()).padStart(2,"0");
  const todayRiyadh = yr + "-" + mo + "-" + dy;
  const todayUTC    = new Date().toISOString().split("T")[0];

  const dayNow     = nowRiyadh.getDay();
  const minNow     = nowRiyadh.getHours()*60 + nowRiyadh.getMinutes();
  const marketOpen = (dayNow >= 0 && dayNow <= 4) && minNow >= 600 && minNow <= 930;

  const isToday = marketOpen ? lastDateStr >= todayRiyadh : true;

  return res.status(200).json({
    symbol,
    lastDateStr,
    todayRiyadh,
    todayUTC,
    dayNow,
    minNow,
    marketOpen,
    isToday,
    total_candles: sorted.length,
  });
}
