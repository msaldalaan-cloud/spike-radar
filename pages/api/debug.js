const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  try {
    const symbol   = req.query.symbol || "8100";
    const sahmkKey = process.env.SAHMK_API_KEY;

    // جرب عدة روابط مختلفة
    const urls = [
      `${BASE}/historical/${symbol}/?period=daily&limit=30`,
      `${BASE}/historical/${symbol}/?interval=1d&limit=30`,
      `${BASE}/history/${symbol}/?period=daily&limit=30`,
      `${BASE}/ohlc/${symbol}/?period=daily&limit=30`,
    ];

    const results = {};
    for (const url of urls) {
      try {
        const r    = await fetch(url, { headers: { "X-API-Key": sahmkKey } });
        const text = await r.text();
        results[url.replace(BASE,"")] = {
          status: r.status,
          preview: text.slice(0, 200)
        };
      } catch(e) {
        results[url.replace(BASE,"")] = { error: e.message };
      }
    }

    return res.status(200).json(results);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
