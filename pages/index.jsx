import { useState, useEffect } from "react";

const DEFAULT_CFG = {
  // Stochastic — كل فاصل مستقل
  stochDaily:  false, stochDailyMode:   "يعبر الآن",
  stochWeekly: false, stochWeeklyMode:  "يعبر الآن",
  stochMonthly:false, stochMonthlyMode: "يعبر الآن",
  stochOS: false, stochOSLevel: 20, stochMid: false,
  // DMA — كل فاصل مستقل
  dmaDaily:    false, dmaDailyMode:     "يعبر الآن",
  dmaWeekly:   false, dmaWeeklyMode:    "يعبر الآن",
  dmaMonthly:  false, dmaMonthlyMode:   "يعبر الآن",
  dmaZero: false, dmaSMA50: false,
};

export default function Scanner() {
  const [cfg, setCfg]             = useState(DEFAULT_CFG);
  const [strategies, setStrats]   = useState([]);
  const [stratName, setStratName] = useState("");
  const [results, setResults]     = useState([]);
  const [scanning, setScanning]   = useState(false);
  const [log, setLog]             = useState([]);
  const [marketOpen, setMarketOpen] = useState(false);

  const isMarketOpen = () => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh" }));
    const day = now.getDay();
    if (day === 5 || day === 6) return false;
    const m = now.getHours() * 60 + now.getMinutes();
    return m >= 600 && m <= 930;
  };

  useEffect(() => {
    fetchStrategies();
    setMarketOpen(isMarketOpen());
    const tick = setInterval(() => setMarketOpen(isMarketOpen()), 30000);
    return () => clearInterval(tick);
  }, []);

  // ── استراتيجيات من الـ API ────────────────────────────────────
  const fetchStrategies = async () => {
    try {
      const r = await fetch("/api/strategies");
      setStrats(await r.json());
    } catch { addLog("❌ فشل جلب الاستراتيجيات", "err"); }
  };

  const saveStrategy = async () => {
    if (!stratName.trim()) return;
    try {
      const r = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: stratName, cfg: { ...cfg } }),
      });
      const s = await r.json();
      setStrats(p => [...p, s]);
      setStratName("");
      addLog(`💾 تم حفظ وتفعيل: ${s.name} — يعمل في الخلفية`, "ok");
    } catch (e) { addLog("❌ " + e.message, "err"); }
  };

  const deleteStrategy = async (id) => {
    try {
      await fetch("/api/strategies", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setStrats(p => p.filter(s => s.id !== id));
      addLog("🗑️ تم الحذف — توقف الفحص التلقائي لهذه الاستراتيجية", "info");
    } catch (e) { addLog("❌ " + e.message, "err"); }
  };



  const loadStrategy = (s) => { setCfg(s.cfg); addLog(`📂 تحميل: ${s.name}`, "info"); };

  const addLog = (msg, type = "info") =>
    setLog(p => [{ msg, type, t: new Date().toLocaleTimeString("ar-SA") }, ...p].slice(0, 60));

  // ── فحص ─────────────────────────────────────────────────────
  const runScan = async (scanCfg = cfg) => {
    setScanning(true);
    setResults([]);
    addLog("⏳ جاري الفحص...", "info");
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cfg: scanCfg }),
      });
      const data = await res.json();
      if (data.error) { addLog("❌ " + data.error, "err"); return; }
      setResults(data.results || []);
      const n = (data.results || []).filter(r => r.pass).length;
      addLog(`✅ اكتمل — ${n} إشارة من ${data.results.length} سهم`, "ok");
    } catch (e) { addLog("❌ " + e.message, "err"); }
    finally { setScanning(false); }
  };



  const set = (k, v) => setCfg(p => ({ ...p, [k]: v }));
  const passed = results.filter(r => r.pass);
  const failed = results.filter(r => !r.pass);

  return (
    <div style={S.page}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ textAlign:"center", marginBottom:28 }}>
        <div className="sub">STOCH 5,3,3 · DMA 10,50,10 · SAHMK API</div>
        <h1 style={S.title}>⚡ SPIKE RADAR</h1>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginTop:6 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background: marketOpen?"#00ff88":"#ff4444", animation: marketOpen?"pulse 1.5s infinite":"none" }} />
          <span className="sub" style={{ color: marketOpen?"#00ff88":"#64748b" }}>
            {marketOpen ? "السوق مفتوح" : "السوق مغلق · الأحد–الخميس 10:00–15:30"}
          </span>
        </div>
      </div>

      <div style={S.grid}>

        {/* ── يسار: الإعدادات ── */}
        <div>

          {/* Stochastic */}
          <div className="card">
            <div className="sec-title">📊 STOCHASTIC 5,3,3</div>
            {[
              ["daily",  "stochDaily",  "stochDailyMode",   "يومي"],
              ["weekly", "stochWeekly", "stochWeeklyMode",  "أسبوعي"],
              ["monthly","stochMonthly","stochMonthlyMode", "شهري"],
            ].map(([,activeKey, modeKey, label]) => (
              <div key={activeKey} style={{ marginBottom:10, padding:"10px 12px", borderRadius:6,
                background: cfg[activeKey] ? "rgba(14,165,233,0.08)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${cfg[activeKey] ? "rgba(14,165,233,0.3)" : "#1e3a5f"}`,
                transition:"all .2s" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: cfg[activeKey] ? 10 : 0 }}>
                  <label className="cb" style={{ margin:0 }}>
                    <input type="checkbox" checked={cfg[activeKey]} onChange={e => set(activeKey, e.target.checked)} />
                    <span style={{ color: cfg[activeKey] ? "#e2e8f0" : "#64748b", fontWeight: cfg[activeKey] ? 600 : 400 }}>{label}</span>
                  </label>
                  {cfg[activeKey] && (
                    <div className="trow" style={{ width:"auto" }}>
                      {["يعبر الآن","فوق"].map(m => (
                        <button key={m} className={`tog ${cfg[modeKey]===m?"on":""}`}
                          onClick={() => set(modeKey, m)} style={{ padding:"4px 10px", fontSize:9 }}>{m}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div style={{ borderTop:"1px solid #1e3a5f", paddingTop:10, marginTop:4 }}>
              <label className="cb">
                <input type="checkbox" checked={cfg.stochOS} onChange={e => set("stochOS",e.target.checked)} />
                <span>تقاطع من منطقة Oversold</span>
              </label>
              {cfg.stochOS && (
                <div style={{ paddingRight:22, marginBottom:8 }}>
                  <div className="label">K كان أقل من</div>
                  <input type="number" value={cfg.stochOSLevel} min={1} max={49}
                    onChange={e => set("stochOSLevel",+e.target.value)} style={{ width:80 }} />
                </div>
              )}
              <label className="cb">
                <input type="checkbox" checked={cfg.stochMid} onChange={e => set("stochMid",e.target.checked)} />
                <span>K فوق مستوى 50</span>
              </label>
            </div>
          </div>

          {/* DMA */}
          <div className="card">
            <div className="sec-title">📈 DMA 10,50,10</div>
            {[
              ["daily",  "dmaDaily",   "dmaDailyMode",   "يومي"],
              ["weekly", "dmaWeekly",  "dmaWeeklyMode",  "أسبوعي"],
              ["monthly","dmaMonthly", "dmaMonthlyMode", "شهري"],
            ].map(([,activeKey, modeKey, label]) => (
              <div key={activeKey} style={{ marginBottom:10, padding:"10px 12px", borderRadius:6,
                background: cfg[activeKey] ? "rgba(14,165,233,0.08)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${cfg[activeKey] ? "rgba(14,165,233,0.3)" : "#1e3a5f"}`,
                transition:"all .2s" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: cfg[activeKey] ? 10 : 0 }}>
                  <label className="cb" style={{ margin:0 }}>
                    <input type="checkbox" checked={cfg[activeKey]} onChange={e => set(activeKey, e.target.checked)} />
                    <span style={{ color: cfg[activeKey] ? "#e2e8f0" : "#64748b", fontWeight: cfg[activeKey] ? 600 : 400 }}>{label}</span>
                  </label>
                  {cfg[activeKey] && (
                    <div className="trow" style={{ width:"auto" }}>
                      {["يعبر الآن","فوق"].map(m => (
                        <button key={m} className={`tog ${cfg[modeKey]===m?"on":""}`}
                          onClick={() => set(modeKey, m)} style={{ padding:"4px 10px", fontSize:9 }}>{m}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div style={{ borderTop:"1px solid #1e3a5f", paddingTop:10, marginTop:4 }}>
              <label className="cb">
                <input type="checkbox" checked={cfg.dmaZero} onChange={e => set("dmaZero",e.target.checked)} />
                <span>DIF فوق الصفر</span>
              </label>
              <label className="cb">
                <input type="checkbox" checked={cfg.dmaSMA50} onChange={e => set("dmaSMA50",e.target.checked)} />
                <span>السعر فوق SMA 50</span>
              </label>
            </div>
          </div>

          {/* الاستراتيجيات */}
          <div className="card">
            <div className="sec-title">💾 الاستراتيجيات</div>
            <div style={{ display:"flex", gap:8, marginBottom:12 }}>
              <input type="text" value={stratName} onChange={e => setStratName(e.target.value)}
                placeholder="اسم الاستراتيجية..." />
              <button className="btn btn-green btn-sm" onClick={saveStrategy} style={{ whiteSpace:"nowrap" }}>حفظ</button>
            </div>
            {strategies.length === 0
              ? <div style={{ fontSize:10, color:"#475569", fontFamily:"mono", textAlign:"center", padding:"8px 0" }}>لا توجد استراتيجيات محفوظة</div>
              : strategies.map(s => (
                <div key={s.id} className="srow">
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:7, height:7, borderRadius:"50%", background:"#00ff88", animation:"pulse 2s infinite", flexShrink:0 }} />
                    <span style={{ fontSize:11, color:"#e2e8f0", fontFamily:"mono" }}>{s.name}</span>
                  </div>
                  <div style={{ display:"flex", gap:6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => loadStrategy(s)}>تحميل</button>
                    <button className="btn btn-red btn-sm" onClick={() => deleteStrategy(s.id)}>حذف</button>
                  </div>
                </div>
              ))
            }
            {strategies.length > 0 && (
              <div style={{ fontSize:9, color:"#00ff88", marginTop:8, fontFamily:"mono", display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:"#00ff88", animation:"pulse 1.5s infinite" }} />
                {strategies.length} استراتيجية تعمل في الخلفية على Vercel
              </div>
            )}
          </div>
        </div>

        {/* ── يمين: التشغيل والنتائج ── */}
        <div>

          {/* التشغيل */}
          <div className="card">
            <div className="sec-title">🚀 التشغيل</div>
            <button className="btn btn-primary" style={{ width:"100%", marginBottom:12 }} onClick={() => runScan()} disabled={scanning}>
              {scanning ? "⏳ جاري الفحص..." : "▶  فحص يدوي الآن"}
            </button>
            <div style={S.sbar}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:"#00ff88", animation:"pulse 1.5s infinite" }} />
                <span style={{ fontSize:10, color:"#00ff88", fontFamily:"mono" }}>
                  الفحص التلقائي يعمل على السيرفر — مستقل عن اللاب توب
                </span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background: marketOpen?"#00ff88":"#ff4444" }} />
                <span style={{ fontSize:9, color: marketOpen?"#00ff88":"#64748b", fontFamily:"mono" }}>
                  {marketOpen ? "السوق مفتوح" : "السوق مغلق"}
                </span>
              </div>
            </div>
          </div>

          {/* النتائج — إشارات */}
          {passed.length > 0 && (
            <div className="card">
              <div className="sec-title">✅ إشارات ({passed.length})</div>
              <div style={{ maxHeight:280, overflowY:"auto" }}>
                {passed.map((r,i) => (
                  <div key={i} className="rrow" style={{ background:"rgba(0,255,136,0.06)", border:"1px solid rgba(0,255,136,0.2)" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:"#00ff88", animation:"pulse 2s infinite" }} />
                      <div>
                        <div style={{ fontWeight:700, fontSize:13, color:"#fff", fontFamily:"mono", letterSpacing:1 }}>{r.symbol}</div>
                        <div style={{ fontSize:9, color:"#475569", fontFamily:"mono" }}>{r.name}</div>
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:14, alignItems:"center" }}>
                      <div>
                        <div style={{ fontSize:9, color:"#334155", fontFamily:"mono" }}>K / D</div>
                        <div style={{ fontSize:11, color:"#00ff88", fontFamily:"mono" }}>{r.k?.toFixed(1)} / {r.d?.toFixed(1)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize:9, color:"#334155", fontFamily:"mono" }}>DIF</div>
                        <div style={{ fontSize:11, color: r.dif>0?"#00ff88":"#ff4444", fontFamily:"mono" }}>{r.dif?.toFixed(3)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* النتائج — لم تجتز */}
          {failed.length > 0 && (
            <div className="card">
              <div className="sec-title" style={{ color:"#475569" }}>— لم تجتز ({failed.length})</div>
              <div style={{ maxHeight:200, overflowY:"auto" }}>
                {failed.map((r,i) => (
                  <div key={i} className="rrow" style={{ background:"transparent", border:"1px solid #1e3a5f", opacity:0.55 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ width:6, height:6, borderRadius:"50%", background:"#334155" }} />
                      <span style={{ fontSize:12, color:"#64748b", fontFamily:"mono" }}>{r.symbol}</span>
                    </div>
                    <div style={{ display:"flex", gap:14 }}>
                      <div>
                        <div style={{ fontSize:9, color:"#1e3a5f", fontFamily:"mono" }}>K / D</div>
                        <div style={{ fontSize:11, color:"#475569", fontFamily:"mono" }}>{r.k?.toFixed(1)} / {r.d?.toFixed(1)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize:9, color:"#1e3a5f", fontFamily:"mono" }}>DIF</div>
                        <div style={{ fontSize:11, color:"#475569", fontFamily:"mono" }}>{r.dif?.toFixed(3)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.length === 0 && !scanning && (
            <div className="card" style={{ textAlign:"center", color:"#334155", fontSize:11, padding:"32px 0", fontFamily:"mono" }}>
              لا توجد نتائج — اضغط فحص الآن
            </div>
          )}

          {/* السجل */}
          <div className="card">
            <div className="sec-title">📝 السجل</div>
            <div style={{ maxHeight:200, overflowY:"auto" }}>
              {log.length === 0
                ? <div style={{ fontSize:10, color:"#334155", fontFamily:"mono" }}>لا يوجد سجل</div>
                : log.map((l,i) => (
                  <div key={i} style={{ fontSize:10, lineHeight:2, fontFamily:"mono",
                    color: l.type==="ok"?"#00ff88" : l.type==="err"?"#ff4444" : "#64748b" }}>
                    <span style={{ color:"#1e3a5f" }}>{l.t} </span>{l.msg}
                  </div>
                ))
              }
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  :root{font-family:'IBM Plex Mono',monospace}
  ::-webkit-scrollbar{width:4px}
  ::-webkit-scrollbar-thumb{background:#1e3a5f;border-radius:2px}
  input[type=text],input[type=number]{
    background:#0a1628;border:1px solid #1e3a5f;color:#e2e8f0;
    padding:8px 10px;border-radius:5px;font-size:11px;outline:none;width:100%;transition:border .2s}
  input:focus{border-color:#0ea5e9}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
  .card{background:#0d1526;border:1px solid #1e3a5f;border-radius:8px;padding:16px;margin-bottom:12px}
  .sec-title{font-size:9px;letter-spacing:3px;color:#0ea5e9;margin-bottom:14px}
  .sub{font-size:10px;letter-spacing:3px;color:#0ea5e9}
  .label{font-size:9px;letter-spacing:1.5px;color:#64748b;margin-bottom:5px}
  .btn{border:none;padding:9px 18px;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;letter-spacing:1px;transition:all .2s;font-family:'IBM Plex Mono',monospace}
  .btn:disabled{opacity:.4;cursor:not-allowed}
  .btn-primary{background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff}
  .btn-primary:hover:not(:disabled){filter:brightness(1.15);transform:translateY(-1px)}
  .btn-green{background:linear-gradient(135deg,#059669,#047857);color:#fff}
  .btn-green:hover:not(:disabled){filter:brightness(1.15)}
  .btn-red{background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff}
  .btn-sm{padding:5px 12px;font-size:10px}
  .trow{display:flex;border:1px solid #1e3a5f;border-radius:5px;overflow:hidden}
  .tog{flex:1;padding:7px;text-align:center;cursor:pointer;font-size:10px;background:transparent;border:none;color:#64748b;transition:all .2s;font-family:'IBM Plex Mono',monospace}
  .tog.on{background:#0ea5e9;color:#fff}
  .cb{display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;font-size:11px;color:#94a3b8}
  .cb input{width:auto}
  .rrow{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:6px;margin-bottom:6px;animation:fadeIn .3s ease}
  .srow{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:5px;background:#0a1628;border:1px solid #1e3a5f;margin-bottom:6px}
`;

const S = {
  page:  { background:"#080c14", minHeight:"100vh", color:"#e2e8f0", padding:"20px 16px" },
  title: { fontSize:28, fontWeight:700, letterSpacing:4, color:"#fff", textShadow:"0 0 30px rgba(14,165,233,0.5)", margin:"6px 0" },
  grid:  { maxWidth:960, margin:"0 auto", display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 },
  sbar:  { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 12px", background:"#080c14", borderRadius:5, border:"1px solid #1e3a5f" },
};
