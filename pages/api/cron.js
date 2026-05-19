// pages/api/cron.js
import { kv } from "@vercel/kv";
import nodemailer from "nodemailer";

export default async function handler(req, res) {

  const auth = req.headers["authorization"];
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now  = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh" }));
  const day  = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();

  const isWeekday   = day >= 0 && day <= 4;
  const isMarketHrs = mins >= 600 && mins <= 930;

  if (!isWeekday || !isMarketHrs) {
    return res.status(200).json({
      skipped: true,
      reason:  "السوق مغلق",
      time:    now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
    });
  }

  const sahmkKey  = process.env.SAHMK_API_KEY;
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;
  const base      = process.env.NEXT_PUBLIC_BASE_URL;

  if (!sahmkKey) return res.status(500).json({ error: "SAHMK_API_KEY missing" });

  let strategies = [];
  try {
    const all = await kv.get("spike_strategies");
    strategies = (Array.isArray(all) ? all : []).filter(s => s.active);
  } catch (e) {
    return res.status(500).json({ error: "KV error: " + e.message });
  }

  if (strategies.length === 0) {
    return res.status(200).json({ ran: true, reason: "لا توجد استراتيجيات" });
  }

  const allPassed = [];

  for (const strat of strategies) {
    try {
      const scanRes = await fetch(`${base}/api/scan`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ cfg: strat.cfg }),
      });
      const data   = await scanRes.json();
      const passed = (data.results || []).filter(r => r.pass);
      if (passed.length > 0) allPassed.push({ stratName: strat.name, passed });
    } catch (e) {
      console.error(`Cron error — ${strat.name}:`, e.message);
    }
  }

  if (allPassed.length > 0 && emailUser && emailPass) {
    const totalSignals = allPassed.reduce((a, b) => a + b.passed.length, 0);
    const timeStr = now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });

    // بناء HTML الإيميل
    const rows = allPassed.flatMap(({ stratName, passed }) =>
      passed.map(r => `
        <tr>
          <td style="padding:10px;border-bottom:1px solid #1e3a5f;font-weight:700;color:#00ff88;font-family:monospace">${r.symbol}</td>
          <td style="padding:10px;border-bottom:1px solid #1e3a5f;color:#94a3b8">${r.name || ""}</td>
          <td style="padding:10px;border-bottom:1px solid #1e3a5f;color:#e2e8f0;font-family:monospace">${r.k?.toFixed(1) ?? "-"} / ${r.d?.toFixed(1) ?? "-"}</td>
          <td style="padding:10px;border-bottom:1px solid #1e3a5f;color:${(r.dif??0)>0?"#00ff88":"#ff4444"};font-family:monospace">${r.dif?.toFixed(3) ?? "-"}</td>
          <td style="padding:10px;border-bottom:1px solid #1e3a5f;color:#64748b;font-size:11px">${stratName}</td>
        </tr>`)
    ).join("");

    const html = `
<!DOCTYPE html>
<html dir="rtl">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#080c14;font-family:'IBM Plex Mono',monospace">
  <div style="max-width:600px;margin:0 auto;padding:24px">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:24px">
      <div style="font-size:11px;letter-spacing:3px;color:#0ea5e9;margin-bottom:6px">
        STOCH 5,3,3 · DMA 10,50,10 · SAHMK API
      </div>
      <h1 style="font-size:26px;font-weight:700;color:#fff;letter-spacing:4px;margin:0">
        ⚡ SPIKE RADAR
      </h1>
      <div style="margin-top:8px;font-size:12px;color:#64748b">${timeStr}</div>
    </div>

    <!-- Stats -->
    <div style="display:flex;gap:12px;margin-bottom:20px;justify-content:center">
      <div style="background:#0d1526;border:1px solid #00ff88;border-radius:8px;padding:14px 24px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:#00ff88">${totalSignals}</div>
        <div style="font-size:10px;color:#64748b;letter-spacing:2px">إشارة</div>
      </div>
      <div style="background:#0d1526;border:1px solid #1e3a5f;border-radius:8px;padding:14px 24px;text-align:center">
        <div style="font-size:28px;font-weight:700;color:#0ea5e9">${allPassed.length}</div>
        <div style="font-size:10px;color:#64748b;letter-spacing:2px">استراتيجية</div>
      </div>
    </div>

    <!-- Table -->
    <div style="background:#0d1526;border:1px solid #1e3a5f;border-radius:8px;overflow:hidden">
      <div style="padding:12px 16px;background:#080c14;border-bottom:1px solid #1e3a5f">
        <span style="font-size:9px;letter-spacing:3px;color:#0ea5e9">✅ الإشارات</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#080c14">
            <th style="padding:8px 10px;text-align:right;font-size:9px;color:#334155;letter-spacing:2px">الرمز</th>
            <th style="padding:8px 10px;text-align:right;font-size:9px;color:#334155;letter-spacing:2px">الاسم</th>
            <th style="padding:8px 10px;text-align:right;font-size:9px;color:#334155;letter-spacing:2px">K / D</th>
            <th style="padding:8px 10px;text-align:right;font-size:9px;color:#334155;letter-spacing:2px">DIF</th>
            <th style="padding:8px 10px;text-align:right;font-size:9px;color:#334155;letter-spacing:2px">الاستراتيجية</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:20px;font-size:10px;color:#334155">
      SPIKE RADAR · السوق السعودي · تداول
    </div>
  </div>
</body>
</html>`;

    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: emailUser, pass: emailPass },
      });

      await transporter.sendMail({
        from:    `"⚡ SPIKE RADAR" <${emailUser}>`,
        to:      emailUser,
        subject: `⚡ SPIKE RADAR -- ${totalSignals} إشارة | ${timeStr}`,
        html,
      });
    } catch (e) {
      console.error("Email error:", e.message);
    }
  }

  return res.status(200).json({
    ran:     true,
    time:    now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
    signals: allPassed.length,
    total:   allPassed.reduce((a, b) => a + b.passed.length, 0),
  });
}
