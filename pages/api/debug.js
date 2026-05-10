const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  try {
    const symbol   = req.query.symbol || "8100";
    const sahmkKey = process.env.SAHMK_API_KEY;

    // احسب تاريخ سنة كاملة للخلف
    const to   = new Date().toISOString().split("T")[0];
    const from = new Date(Date.now() - 365*24*60*60*1000).toISOString().split("T")[0];

    // جرب عدة طرق لجلب بيانات أكثر
    const urls = [
      `${BASE}/historical/${symbol}/?period=daily&from=${from}&to=${to}`,
      `${BASE}/historical/${symbol}/?period=daily&from=${from}`,
      `${BASE}/historical/${symbol}/?period=daily&start=${from}&end=${to}`,
      `${BASE}/historical/${symbol}/?period=daily&limit=500&offset=0`,
    ];

    const results = {};
    for (const url of urls) {
      const r    = await fetch(url, { headers: { "X-API-Key": sahmkKey } });
      const json = await r.json();
      const data = json.data || json.results || [];
      results[url.split("?")[1]] = {
        count: data.length,
        first: data[0]?.date,
        last:  data[data.length-1]?.date,
      };
    }

    return res.status(200).json({ symbol, from, to, results });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
