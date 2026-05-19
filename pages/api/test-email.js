import nodemailer from "nodemailer";

export default async function handler(req, res) {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (!emailUser || !emailPass)
    return res.status(500).json({ error: "EMAIL_USER أو EMAIL_PASS غير موجود" });

  const now     = new Date(new Date().toLocaleString("en-US",{timeZone:"Asia/Riyadh"}));
  const timeStr = now.toLocaleString("ar-SA",{timeZone:"Asia/Riyadh"});

  const html = `
<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#080c14;font-family:monospace">
<div style="max-width:600px;margin:0 auto;padding:24px">
  <div style="text-align:center;margin-bottom:24px">
    <div style="font-size:11px;letter-spacing:3px;color:#0ea5e9">STOCH 5,3,3 · DMA 10,50,10</div>
    <h1 style="font-size:26px;color:#fff;letter-spacing:4px;margin:6px 0">⚡ SPIKE RADAR</h1>
    <div style="font-size:12px;color:#64748b">${timeStr}</div>
  </div>
  <div style="background:#0d1526;border:1px solid #1e3a5f;border-radius:8px;overflow:hidden">
    <div style="padding:12px 16px;background:#080c14;border-bottom:1px solid #1e3a5f">
      <span style="font-size:9px;letter-spacing:3px;color:#0ea5e9">✅ إشارات الاختبار</span>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#080c14">
        <th style="padding:8px;text-align:right;font-size:9px;color:#334155">الرمز</th>
        <th style="padding:8px;text-align:right;font-size:9px;color:#334155">K / D</th>
        <th style="padding:8px;text-align:right;font-size:9px;color:#334155">DIF</th>
      </tr></thead>
      <tbody>
        <tr>
          <td style="padding:10px;border-bottom:1px solid #1e3a5f;color:#00ff88;font-weight:700">2287</td>
          <td style="padding:10px;border-bottom:1px solid #1e3a5f;color:#e2e8f0">57.5 / 57.3</td>
          <td style="padding:10px;border-bottom:1px solid #1e3a5f;color:#00ff88">0.081</td>
        </tr>
        <tr>
          <td style="padding:10px;color:#00ff88;font-weight:700">1030</td>
          <td style="padding:10px;color:#e2e8f0">45.2 / 38.1</td>
          <td style="padding:10px;color:#00ff88">1.234</td>
        </tr>
      </tbody>
    </table>
  </div>
  <div style="text-align:center;margin-top:20px;font-size:10px;color:#334155">SPIKE RADAR · اختبار</div>
</div></body></html>`;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailUser, pass: emailPass },
    });

    await transporter.sendMail({
      from:    `"⚡ SPIKE RADAR" <${emailUser}>`,
      to:      emailUser,
      subject: `⚡ SPIKE RADAR -- اختبار | ${timeStr}`,
      html,
    });

    return res.status(200).json({ ok: true, sent_to: emailUser });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
