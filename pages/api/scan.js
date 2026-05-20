// pages/api/scan.js -- v5.0 -- weekly aggregation + K/D fix

export const config = { maxDuration: 300 }; // Vercel Pro max 300s

const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  if (req.method === "GET")
    return res.status(200).json({ version: "7.1-debug", status: "ok" });
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { cfg } = req.body;
  const sahmkKey = process.env.SAHMK_API_KEY;
  if (!sahmkKey)
    return res.status(500).json({ error: "SAHMK_API_KEY ??? ?????" });

  const startTime = Date.now();

  try {
    // ?? 1. ??? ????? ???? TASI ??? ??????????????????????????
    const listRes = await fetch(`${BASE}/companies/?market=TASI&limit=500`, {
      headers: { "X-API-Key": sahmkKey },
    });
    if (!listRes.ok) return res.status(500).json({ error: `??? ??? ??????: ${listRes.status}` });

    const listData = await listRes.json();
    const stocks = (listData.results || []).filter(s =>
      s.symbol &&
      /^[1-9]\d{3}$/.test(s.symbol) &&
      s.market === "TASI" &&
      s.status === "active"
    );

    if (!stocks.length)
      return res.status(200).json({ results: [], scannedAt: new Date().toISOString() });

    const results = [];
        const CONCURRENT = 8;

    const processStock = async (stock) => {
      const symbol = stock.symbol;
      try {
        const stochResults = {}, dmaResults = {};
        // cache ???????? -- ???? ?? ???? ??? ????? ???
        const ohlcCache = {};

        const getOHLC = async (interval) => {
          if (!ohlcCache[interval]) {
            ohlcCache[interval] = await fetchOHLC(sahmkKey, symbol, interval);
          }
          return ohlcCache[interval];
        };

        // ????? ??????? ????????
        const neededIntervals = new Set();
        if (cfg.stochDaily   || cfg.dmaDaily)   neededIntervals.add("1d");
        if (cfg.stochWeekly  || cfg.dmaWeekly)  neededIntervals.add("1w");
        if (cfg.stochMonthly || cfg.dmaMonthly) neededIntervals.add("1m");
        // SMA50 ????? ???? ??????
        if ([cfg.stochDailySMA50,cfg.stochWeeklySMA50,cfg.stochMonthlySMA50,
             cfg.dmaDailySMA50,cfg.dmaWeeklySMA50,cfg.dmaMonthlySMA50].some(Boolean))
          neededIntervals.add("1d");

        // ??? ??????? ???? ?????? ?????? ?????
        await Promise.all([...neededIntervals].map(iv => getOHLC(iv)));

        // ???? Stoch
        for (const [key, cfgKey, interval] of [
          ["daily",   "stochDaily",   "1d"],
          ["weekly",  "stochWeekly",  "1w"],
          ["monthly", "stochMonthly", "1m"],
        ]) {
          if (!cfg[cfgKey]) continue;
          const data = ohlcCache[interval];
          if (data) stochResults[key] = { ...calcStoch(data.closes, data.highs, data.lows, 5, 3, 3), isToday: data.isToday };
        }

        // ???? DMA (?? ??? ??? cache)
        for (const [key, cfgKey, interval] of [
          ["daily",   "dmaDaily",   "1d"],
          ["weekly",  "dmaWeekly",  "1w"],
          ["monthly", "dmaMonthly", "1m"],
        ]) {
          if (!cfg[cfgKey]) continue;
          const data = ohlcCache[interval];
          if (data) { const r = calcDMA(data.closes, 10, 50, 10); if (r) dmaResults[key] = { ...r, isToday: data.isToday }; }
        }

        // SMA50 ?? ??? cache
        const dailyCloses = ohlcCache["1d"]?.closes || null;
        const evaluation = evalSignal(stochResults, dmaResults, cfg, dailyCloses);

        return {
          symbol,
          name:  stock.name_ar || stock.name_en || symbol,
          pass:  evaluation.pass,
          k:     evaluation.k    != null ? +evaluation.k.toFixed(2)    : null,
          d:     evaluation.d    != null ? +evaluation.d.toFixed(2)    : null,
          dif:   evaluation.dif  != null ? +evaluation.dif.toFixed(4)  : null,
          difma: evaluation.difma!= null ? +evaluation.difma.toFixed(4): null,
        };
      } catch { return null; }
    };

    // ????? ????? ??????? -- 8 ???? ?? ?? ????
    for (let i = 0; i < stocks.length; i += CONCURRENT) {
      if (Date.now() - startTime > 280000) break;
      const batch   = stocks.slice(i, i + CONCURRENT);
      const settled = await Promise.allSettled(batch.map(s => processStock(s)));
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value) results.push(r.value);
      }
    }

    return res.status(200).json({ results, scannedAt: new Date().toISOString() });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ?? ??? OHLC ?????????????????????????????????????????????????????
async function fetchOHLC(apiKey, symbol, interval) {
  const to   = new Date().toISOString().split("T")[0];
  // ???? ?????? ?????? ????? ?? ??????? ??????
  const days = interval === "1m" ? 1825 : 730;
  const from = new Date(Date.now() - days*24*60*60*1000).toISOString().split("T")[0];

  const url = `${BASE}/historical/${symbol}/?interval=1d&from=${from}&to=${to}`;
  const r   = await fetch(url, { headers: { "X-API-Key": apiKey } });
  if (!r.ok) return null;

  const json    = await r.json();
  const daily   = json.data || [];
  if (daily.length < 10) return null;

  const sorted = [...daily].sort((a, b) => new Date(a.date) - new Date(b.date));

  // ????: ??? ???? ?? ???? ???? ?? 7 ????
  const lastDate = new Date(sorted[sorted.length-1].date);
  if ((Date.now() - lastDate) / 86400000 > 7) return null;

  // ?? ??? ???? ?? ??????
  const todayStr    = new Date().toISOString().split("T")[0];
  const lastStr     = sorted[sorted.length-1].date;

  // quote يُضاف لاحقاً بتوقيت الرياض

  const lastDateStr = sorted[sorted.length-1].date;

  // ??? ??? ????? -- ???? ????? ??? ??? ??? ???
  const lastTradingDay = (() => {
    const d = new Date();
    // ????? ???????: ?????-??????
    const day = d.getDay(); // 0=Sun,1=Mon,...,5=Fri,6=Sat
    if (day === 5) d.setDate(d.getDate()-1);      // ???? ? ????
    else if (day === 6) d.setDate(d.getDate()-2); // ??? ? ????
    return d.toISOString().split("T")[0];
  })();

  // isToday = ??? ???? ?? ??? ??? ?????
  // اذا السوق مفتوح الان يجب ان تكون شمعه اليوم موجوده
  // اذا السوق مغلق يكفي ان تكون آخر شمعه = آخر يوم تداول
  // حساب تاريخ اليوم بتوقيت الرياض
  const nowRiyadh  = new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Riyadh"}));
  const dayNow     = nowRiyadh.getDay();
  const minNow     = nowRiyadh.getHours()*60 + nowRiyadh.getMinutes();
  const marketOpen = (dayNow >= 0 && dayNow <= 4) && minNow >= 600 && minNow <= 930;
  // تاريخ اليوم بتوقيت الرياض (وليس UTC)
  const yr = nowRiyadh.getFullYear();
  const mo = String(nowRiyadh.getMonth()+1).padStart(2,"0");
  const dy = String(nowRiyadh.getDate()).padStart(2,"0");
  const todayRiyadh = yr + "-" + mo + "-" + dy;
  // جلب السعر الحي مرة واحدة
  let livePrice = null, liveHigh = null, liveLow = null;
  try {
    const qr    = await fetch(`${BASE}/quote/${symbol}/`, { headers: { "X-API-Key": apiKey } });
    const qjson = await qr.json();
    if (qjson.price) {
      livePrice = +qjson.price;
      liveHigh  = qjson.high ? +qjson.high : livePrice;
      liveLow   = qjson.low  ? +qjson.low  : livePrice;
    }
  } catch {}

  // اليومي: اضف او استبدل شمعة اليوم
  if (interval === "1d") {
    if (livePrice) {
      const idx = sorted.findIndex(c => c.date === todayRiyadh);
      const prevOpen = idx !== -1 ? +sorted[idx].open : +sorted[sorted.length-1].close;
      if (idx !== -1) sorted.splice(idx, 1);
      sorted.push({
        date:  todayRiyadh,
        open:  prevOpen,
        high:  liveHigh,
        low:   liveLow,
        close: livePrice,
      });
    }
    const lastD   = sorted[sorted.length-1].date;
    const isToday = marketOpen ? lastD >= todayRiyadh : lastD >= lastTradingDay;
    return {
      closes:  sorted.map(c => +c.close),
      highs:   sorted.map(c => +c.high),
      lows:    sorted.map(c => +c.low),
      isToday,
    };
  }

  // الاسبوعي والشهري: جمّع اولاً ثم حدّث آخر شمعة بالسعر الحي
  const aggregated = aggregateCandles(sorted, interval);
  if (aggregated.length < 10) {
    console.log(`${symbol} ${interval} aggregated.length=${aggregated.length} < 10 -> null`);
    return null;
  }

  if (livePrice) {
    const last = aggregated[aggregated.length-1];
    last.close = livePrice;
    if (liveHigh > last.high) last.high = liveHigh;
    if (liveLow  < last.low)  last.low  = liveLow;
  }

  const lastAgg = aggregated[aggregated.length-1].date;
  const isToday = lastAgg >= lastTradingDay;

  return {
    closes:  aggregated.map(c => c.close),
    highs:   aggregated.map(c => c.high),
    lows:    aggregated.map(c => c.low),
    isToday,
  };
}

// ?? ????? ??????? ?????? ??????????????????????????????????????????
function aggregateCandles(daily, interval) {
  const groups = {};

  for (const c of daily) {
    const d   = new Date(c.date);
    let key;

    if (interval === "1w") {
      // ????? ???????: ??? ????? = ????? ???????
      const day    = d.getDay(); // 0=Sun
      const sunday = new Date(d);
      sunday.setDate(d.getDate() - day);
      key = sunday.toISOString().split("T")[0];
    } else {
      // ????
      key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    }

    if (!groups[key]) {
      groups[key] = { open: +c.open, high: +c.high, low: +c.low, close: +c.close, date: c.date };
    } else {
      groups[key].high  = Math.max(groups[key].high, +c.high);
      groups[key].low   = Math.min(groups[key].low,  +c.low);
      groups[key].close = +c.close; // ??? ????? ?? ???????/?????
    }
  }

  // ????? ?? ???????? ??? ???? ?????? (?????? ????? ???? ??? ????)
  const keys = Object.keys(groups).sort();
  return keys.map(k => groups[k]);
}

// ?? Stochastic 5,3,3 ?????????????????????????????????????????????
function calcStoch(closes, highs, lows, kPeriod, smooth, dPeriod) {
  const rawK = [];
  for (let i = kPeriod-1; i < closes.length; i++) {
    let hh = highs[i], ll = lows[i];
    for (let j = i-kPeriod+1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j]  < ll) ll = lows[j];
    }
    rawK.push(hh === ll ? 50 : ((closes[i]-ll)/(hh-ll))*100);
  }

  const K = [];
  for (let i = smooth-1; i < rawK.length; i++) {
    let sum = 0;
    for (let j = i-smooth+1; j <= i; j++) sum += rawK[j];
    K.push(sum / smooth);
  }

  const D = [];
  for (let i = dPeriod-1; i < K.length; i++) {
    let sum = 0;
    for (let j = i-dPeriod+1; j <= i; j++) sum += K[j];
    D.push(sum / dPeriod);
  }

  // %K = ??? ???? ?? K (??????)
  // %D = ??? ???? ?? D (??????) -- D ???? ?? K ?? (dPeriod-1)
  // ??????? ??? ??????: ??? D[m] ????? K[m + dPeriod-1]
  // ??? ??? -- K ?? ?????? (%K)? D ?? ?????? (%D = SMA of K)
  // D ???? ?? K ?? (dPeriod-1) ?????
  const m      = D.length - 1;
  // %D = ??? D (??????)
  // %K ???????? = K[m + dPeriod-1] = K[K.length-1]
  // K = %K (??????) , D = %D (?????? = SMA of K)
  // ?????? ????: k < d ?? ??????? k > d ?? ??????
  const k     = K[m + (dPeriod-1)];      // ??? %K
  const kPrev = K[m + (dPeriod-1) - 1];
  const d     = D[m];                    // ??? %D
  const dPrev = D[m-1];

  const crossedLastBar = kPrev < dPrev && k > d;
  const kAbovePrev     = kPrev > dPrev;

  return { k, kPrev, d, dPrev, crossedLastBar, kAbovePrev };
}

// ?? DMA 10,50,10 ?????????????????????????????????????????????????
function calcDMA(closes, fast, slow, signal) {
  if (closes.length < slow + signal) return null;
  const difArr = [];
  for (let i = slow-1; i < closes.length; i++) {
    let sF = 0, sS = 0;
    for (let j = i-fast+1; j <= i; j++) sF += closes[j];
    for (let j = i-slow+1; j <= i; j++) sS += closes[j];
    difArr.push(sF/fast - sS/slow);
  }
  const k2 = 2/(signal+1);
  let difma = difArr.slice(0, signal).reduce((a,b)=>a+b)/signal;
  for (let i = signal; i < difArr.length; i++) difma = difArr[i]*k2 + difma*(1-k2);

  let difmaPrev = difArr.slice(0, signal-1).reduce((a,b)=>a+b)/(signal-1);
  for (let i = signal-1; i < difArr.length-1; i++) difmaPrev = difArr[i]*k2 + difmaPrev*(1-k2);

  const dif     = difArr[difArr.length-1];
  const difPrev = difArr[difArr.length-2];

  const crossedLastBar = difPrev < difmaPrev && dif > difma;
  const difAbovePrev   = difPrev > difmaPrev;

  return { dif, difPrev, difma, difmaPrev, crossedLastBar, difAbovePrev };
}

// ?? ????? ?????? ?????????????????????????????????????????????????
function evalSignal(stochResults, dmaResults, cfg, closes) {
  const sma50 = closes && closes.length >= 50
    ? closes.slice(-50).reduce((a,b)=>a+b)/50 : null;
  const price = closes && closes.length ? closes[closes.length-1] : null;
  const aboveSMA50 = sma50 !== null && price !== null && price > sma50;

  const stochTFs = [
    { active: cfg.stochDaily,   mode: cfg.stochDailyMode,   data: stochResults.daily,
      osKey: cfg.stochDailyOS,  osLvl: cfg.stochDailyOSLevel,  sma50: cfg.stochDailySMA50  },
    { active: cfg.stochWeekly,  mode: cfg.stochWeeklyMode,  data: stochResults.weekly,
      osKey: cfg.stochWeeklyOS, osLvl: cfg.stochWeeklyOSLevel, sma50: cfg.stochWeeklySMA50 },
    { active: cfg.stochMonthly, mode: cfg.stochMonthlyMode, data: stochResults.monthly,
      osKey: cfg.stochMonthlyOS,osLvl: cfg.stochMonthlyOSLevel,sma50: cfg.stochMonthlySMA50},
  ].filter(t => t.active);

  // ??? ???? ????? ??? ?? ?????? ? ??? ??????
  if (stochTFs.some(t => !t.data)) return { pass: false };

  const stochOk = stochTFs.length === 0 || stochTFs.every(t => {
    const { k, d, kPrev, dPrev, crossedLastBar, kAbovePrev } = t.data;
    // crossedLastBar: kPrev < dPrev AND k > d (????? ??? ??? ????)
    // kAbovePrev: kPrev > dPrev (K ???? ??? D ?? ?????? ??????? ?????)
    // ???? ????: ????? ??? ??? ???? + ??? ???? ?????
    const stochCrossed = kPrev < dPrev && k > d && (t.data.isToday === true);
    let ok = t.mode === "يعبر الآن"
      ? stochCrossed
      : (k > d); // ??? = K ??? D ??? ????? ?? ??????
    if (t.osKey && ok) ok = kPrev < (t.osLvl ?? 20);
    if (t.sma50 && ok) ok = aboveSMA50;
    return ok;
  });

  const dmaTFs = [
    { active: cfg.dmaDaily,   mode: cfg.dmaDailyMode,   data: dmaResults.daily,
      zero: cfg.dmaDailyZero,  sma50: cfg.dmaDailySMA50   },
    { active: cfg.dmaWeekly,  mode: cfg.dmaWeeklyMode,  data: dmaResults.weekly,
      zero: cfg.dmaWeeklyZero, sma50: cfg.dmaWeeklySMA50  },
    { active: cfg.dmaMonthly, mode: cfg.dmaMonthlyMode, data: dmaResults.monthly,
      zero: cfg.dmaMonthlyZero,sma50: cfg.dmaMonthlySMA50 },
  ].filter(t => t.active);

  // ??? ???? ????? ??? ?? ?????? ? ??? ??????
  if (dmaTFs.some(t => !t.data)) return { pass: false };

  const dmaOk = dmaTFs.length === 0 || dmaTFs.every(t => {
    const { dif, difma, difPrev, difmaPrev, crossedLastBar, difAbovePrev } = t.data;
    // ???? ????: ????? ??? ??? ???? + ??? ???? ?????
    const dmaCrossed = difPrev < difmaPrev && dif > difma && (t.data.isToday === true);
    let ok = t.mode === "يعبر الآن"
      ? dmaCrossed
      : (dif > difma); // ??? = DIF ??? DIFMA ??? ????? ?? ??????
    if (t.zero  && ok) ok = dif > 0;
    if (t.sma50 && ok) ok = aboveSMA50;
    return ok;
  });

  const ls = stochResults.daily || stochResults.weekly || stochResults.monthly || {};
  const ld = dmaResults.daily   || dmaResults.weekly   || dmaResults.monthly   || {};

  return { pass: stochOk && dmaOk, k: ls.k, d: ls.d, dif: ld.dif, difma: ld.difma };
}
