export default async function handler(req, res) {
  const ejsSvc     = process.env.EMAILJS_SERVICE_ID;
  const ejsTpl     = process.env.EMAILJS_TEMPLATE_ID;
  const ejsPub     = process.env.EMAILJS_PUBLIC_KEY;
  const ejsPrivate = process.env.EMAILJS_PRIVATE_KEY;
  const ejsEmail   = process.env.EMAILJS_TO_EMAIL;

  const now = new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Riyadh"}));

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
          to_email:      ejsEmail,
          title:         "SPIKE RADAR -- اختبار",
          name:          "SPIKE RADAR",
          time:          now.toLocaleString("ar-SA",{timeZone:"Asia/Riyadh"}),
          strategy_name: "استراتيجية الاختبار",
          scan_date:     now.toLocaleDateString("ar-SA",{timeZone:"Asia/Riyadh"}),
          scan_time:     now.toLocaleTimeString("ar-SA",{timeZone:"Asia/Riyadh"}),
          total_signals: "2",
          stocks_list:   "2287 K:57.5/D:57.3 DIF:0.081\n1030 K:45.2/D:38.1 DIF:1.234",
        },
      }),
    });
    const text = await r.text();
    return res.status(200).json({ status: r.status, response: text, ok: r.ok });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
