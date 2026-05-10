// pages/api/debug.js — مؤقت لفحص بيانات سهم معين

const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  const symbol   = req.query.symbol || "8100";
  const sahmkKey = process.env.SAHMK_API_KEY;

  const url = `${BASE}/historical/${symbol}/?period=daily&limit=10`;
  const r   = await fetch(url, { headers: { "X-API-Key": sahmkKey } });
  const json = await r.json();

  // أرجع البيانات الخام + الترتيب بعد الفرز
  const candles = json.results || json.data || json.candles || [];
  const sorted  = [...candles].sort((a, b) =>
    new Date(a.date || a.datetime || 0) - new Date(b.date || b.datetime || 0)
  );

  return res.status(200).json({
    symbol,
    raw_count:    candles.length,
    raw_first:    candles[0],
    raw_last:     candles[candles.length - 1],
    sorted_first: sorted[0],
    sorted_last:  sorted[sorted.length - 1],
    last3_closes: sorted.slice(-3).map(c => ({ date: c.date || c.datetime, close: c.close })),
  });
}
