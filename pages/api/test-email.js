// pages/api/test-email.js -- مؤقت لاختبار EmailJS

export default async function handler(req, res) {
  const ejsSvc   = process.env.EMAILJS_SERVICE_ID;
  const ejsTpl   = process.env.EMAILJS_TEMPLATE_ID;
  const ejsPub   = process.env.EMAILJS_PUBLIC_KEY;
  const ejsEmail = process.env.EMAILJS_TO_EMAIL;

  if (!ejsSvc || !ejsTpl || !ejsPub || !ejsEmail) {
    return res.status(500).json({ 
      error: "متغيرات EmailJS غير موجودة",
      found: { ejsSvc: !!ejsSvc, ejsTpl: !!ejsTpl, ejsPub: !!ejsPub, ejsEmail: !!ejsEmail }
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
        template_params: {
          to_email: ejsEmail,
          subject:  "SPIKE RADAR -- اختبار الإيميل",
          message:  "هذا إيميل اختبار من SPIKE RADAR\n\n• 2287 -- K:57.5 / D:57.3 | DIF:0.081",
          time:     new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" }),
        },
      }),
    });

    const text = await r.text();
    return res.status(200).json({ 
      status: r.status, 
      response: text,
      ok: r.ok,
      to: ejsEmail
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
