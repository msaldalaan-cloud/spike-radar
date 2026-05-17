export default async function handler(req, res) {
  const ejsSvc     = process.env.EMAILJS_SERVICE_ID;
  const ejsTpl     = process.env.EMAILJS_TEMPLATE_ID;
  const ejsPub     = process.env.EMAILJS_PUBLIC_KEY;
  const ejsPrivate = process.env.EMAILJS_PRIVATE_KEY;
  const ejsEmail   = process.env.EMAILJS_TO_EMAIL;

  if (!ejsSvc || !ejsTpl || !ejsPub || !ejsPrivate) {
    return res.status(500).json({ 
      error: "متغيرات EmailJS غير مكتملة",
      found: { ejsSvc:!!ejsSvc, ejsTpl:!!ejsTpl, ejsPub:!!ejsPub, ejsPrivate:!!ejsPrivate }
    });
  }

  try {
    const r = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id:  ejsSvc,
        template_id: ejsTpl,
        user_id:     ejsPub,
        accessToken: ejsPrivate,
        template_params: {
          to_email: ejsEmail,
          subject:  "SPIKE RADAR -- اختبار الإيميل",
          message:  "هذا إيميل اختبار من SPIKE RADAR\n\n• 2287 -- K:57.5 / D:57.3 | DIF:0.081",
          time:     new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
        },
      }),
    });
    const text = await r.text();
    return res.status(200).json({ status: r.status, response: text, ok: r.ok });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
