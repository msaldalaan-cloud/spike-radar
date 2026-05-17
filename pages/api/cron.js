// pages/api/cron.js
// يعمل على Vercel Server 24/7 — مستقل تماماً عن المتصفح أو اللاب توب

import { kv } from "@vercel/kv";

export default async function handler(req, res) {

  // ── حماية الـ Cron ──────────────────────────────────────────
  const auth = req.headers["authorization"];
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ── التحقق من ساعات التداول (توقيت الرياض) ──────────────────
  const now  = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Riyadh" }));
  const day  = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();

  const isWeekday   = day >= 0 && day <= 4; // الأحد–الخميس
  const isMarketHrs = mins >= 600 && mins <= 930; // 10:00–15:30

  if (!isWeekday || !isMarketHrs) {
    return res.status(200).json({
      skipped: true,
      reason:  "السوق مغلق",
      time:    now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
    });
  }

  // ── قراءة المتغيرات من Vercel Environment ───────────────────
  const sahmkKey = process.env.SAHMK_API_KEY;
  const ejsSvc     = process.env.EMAILJS_SERVICE_ID;
  const ejsTpl     = process.env.EMAILJS_TEMPLATE_ID;
  const ejsPub     = process.env.EMAILJS_PUBLIC_KEY;
  const ejsPrivate = process.env.EMAILJS_PRIVATE_KEY;
  const ejsEmail   = process.env.EMAILJS_TO_EMAIL;
  const base     = process.env.NEXT_PUBLIC_BASE_URL;

  if (!sahmkKey) return res.status(500).json({ error: "SAHMK_API_KEY غير موجود" });

  // ── قراءة الاستراتيجيات المفعّلة من Vercel KV ───────────────
  let strategies = [];
  try {
    const all = await kv.get("spike_strategies");
    strategies = (Array.isArray(all) ? all : []).filter(s => s.active);
  } catch (e) {
    return res.status(500).json({ error: "فشل قراءة الاستراتيجيات: " + e.message });
  }

  if (strategies.length === 0) {
    return res.status(200).json({ ran: true, reason: "لا توجد استراتيجيات مفعّلة" });
  }

  // ── تشغيل الفحص لكل استراتيجية ──────────────────────────────
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

  // ── إرسال إيميل إذا وجدت إشارات ────────────────────────────
  if (allPassed.length > 0 && ejsSvc && ejsTpl && ejsPub && ejsEmail) {
    const totalSignals = allPassed.reduce((a, b) => a + b.passed.length, 0);
    const lines = allPassed.flatMap(({ stratName, passed }) => [
      `\n📊 ${stratName}`,
      ...passed.map(r => `  • ${r.symbol} — K:${r.k} / D:${r.d} | DIF:${r.dif}`),
    ]).join("\n");

    try {
      await fetch("https://api.emailjs.com/api/v1.0/email/send", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id:  ejsSvc,
          template_id: ejsTpl,
          user_id:     ejsPub,
          accessToken: ejsPrivate,
          template_params: {
            to_email: ejsEmail,
            subject:  `📊 SPIKE RADAR — ${totalSignals} إشارة`,
            message:  lines,
            time:     now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
          },
        }),
      });
    } catch (e) {
      console.error("EmailJS error:", e.message);
    }
  }

  return res.status(200).json({
    ran:     true,
    time:    now.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
    signals: allPassed.length,
    total:   allPassed.reduce((a, b) => a + b.passed.length, 0),
  });
}
