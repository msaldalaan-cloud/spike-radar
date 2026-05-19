const BASE = "https://app.sahmk.sa/api/v1";

export default async function handler(req, res) {
  const symbol   = req.query.symbol || "1834";
  const sahmkKey = process.env.SAHMK_API_KEY;

  const to   = new Date().toISOString().split("T")[0];
  const from = new Date(Date.now() - 400*24*60*60*1000).toISOString().split("T")[0];

  // جلب يومي
  const daily = await fetch(`${BASE}/historical/${symbol}/?interval=1d&from=${from}&to=${to}`,
    { headers: { "X-API-Key": sahmkKey } }).then(r=>r.json());

  const sorted = [...(daily.data||[])].sort((a,b)=>new Date(a.date)-new Date(b.date));

  // جلب quote اليوم
  const nowR = new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Riyadh"}));
  const yr=nowR.getFullYear(), mo=String(nowR.getMonth()+1).padStart(2,"0"), dy=String(nowR.getDate()).padStart(2,"0");
  const todayRiyadh = `${yr}-${mo}-${dy}`;
  const lastDate = sorted[sorted.length-1]?.date;

  let quoteAdded = false;
  if (lastDate < todayRiyadh) {
    try {
      const q = await fetch(`${BASE}/quote/${symbol}/`,{headers:{"X-API-Key":sahmkKey}}).then(r=>r.json());
      if (q.price) {
        sorted.push({date:todayRiyadh,open:q.open||q.price,high:q.high||q.price,low:q.low||q.price,close:q.price});
        quoteAdded = true;
      }
    } catch {}
  }

  const closes=sorted.map(c=>+c.close), highs=sorted.map(c=>+c.high), lows=sorted.map(c=>+c.low);

  // Stoch 5,3,3
  const rawK=[];
  for(let i=4;i<closes.length;i++){
    let hh=highs[i],ll=lows[i];
    for(let j=i-4;j<=i;j++){if(highs[j]>hh)hh=highs[j];if(lows[j]<ll)ll=lows[j];}
    rawK.push(hh===ll?50:((closes[i]-ll)/(hh-ll))*100);
  }
  const K=[];for(let i=2;i<rawK.length;i++){let s=0;for(let j=i-2;j<=i;j++)s+=rawK[j];K.push(s/3);}
  const D=[];for(let i=2;i<K.length;i++){let s=0;for(let j=i-2;j<=i;j++)s+=K[j];D.push(s/3);}
  const m=D.length-1;
  const k=K[m+2],kPrev=K[m+1],d=D[m],dPrev=D[m-1];

  // SMA50
  const sma50 = closes.length>=50 ? closes.slice(-50).reduce((a,b)=>a+b)/50 : null;
  const price = closes[closes.length-1];

  // DMA 10,50,10
  let dif=null,difma=null;
  if(closes.length>=60){
    const difArr=[];
    for(let i=49;i<closes.length;i++){
      let sF=0,sS=0;
      for(let j=i-9;j<=i;j++)sF+=closes[j];
      for(let j=i-49;j<=i;j++)sS+=closes[j];
      difArr.push(sF/10-sS/50);
    }
    const k2=2/11;
    let dm=difArr.slice(0,10).reduce((a,b)=>a+b)/10;
    for(let i=10;i<difArr.length;i++) dm=difArr[i]*k2+dm*(1-k2);
    dif=difArr[difArr.length-1];
    difma=dm;
  }

  return res.status(200).json({
    symbol,
    lastDate: sorted[sorted.length-1]?.date,
    todayRiyadh,
    quoteAdded,
    isToday: sorted[sorted.length-1]?.date >= todayRiyadh,
    stoch: { k:+k?.toFixed(2), kPrev:+kPrev?.toFixed(2), d:+d?.toFixed(2), dPrev:+dPrev?.toFixed(2),
      crossedLastBar: kPrev<dPrev&&k>d,
      checks: {
        cross: kPrev<dPrev&&k>d,
        oversold60: kPrev<60,
        aboveSMA50: sma50!==null&&price>sma50,
        price, sma50:sma50?.toFixed(2),
      }
    },
    dma: { dif:dif?.toFixed(4), difma:difma?.toFixed(4), aboveDifma: dif!==null&&dif>difma },
  });
}
