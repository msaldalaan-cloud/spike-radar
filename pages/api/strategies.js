// pages/api/strategies.js
// الاستراتيجيات في Vercel KV
// حفظ → active: true تلقائياً (الـ Cron يشتغل)
// حذف → تُحذف نهائياً (الـ Cron لا يشغّلها)

import { kv } from "@vercel/kv";

const KEY = "spike_strategies";

async function readAll() {
  try {
    const data = await kv.get(KEY);
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

async function writeAll(data) {
  await kv.set(KEY, data);
}

export default async function handler(req, res) {

  // ── GET: جلب كل الاستراتيجيات ──────────────────────────────
  if (req.method === "GET") {
    return res.status(200).json(await readAll());
  }

  // ── POST: حفظ استراتيجية جديدة — active: true تلقائياً ─────
  if (req.method === "POST") {
    const { name, cfg } = req.body;
    if (!name || !cfg) return res.status(400).json({ error: "name و cfg مطلوبان" });
    const all    = await readAll();
    const newS   = { id: Date.now(), name, cfg, active: true }; // ← تلقائياً مفعّلة
    await writeAll([...all, newS]);
    return res.status(200).json(newS);
  }

  // ── PATCH: تفعيل / تعطيل ───────────────────────────────────
  if (req.method === "PATCH") {
    const { id, active, cfg, name } = req.body;
    if (!id) return res.status(400).json({ error: "id مطلوب" });
    const all = (await readAll()).map(s =>
      s.id !== id ? s : {
        ...s,
        ...(active !== undefined && { active }),
        ...(cfg    !== undefined && { cfg }),
        ...(name   !== undefined && { name }),
      }
    );
    await writeAll(all);
    return res.status(200).json({ ok: true });
  }

  // ── DELETE: حذف — الـ Cron لن يشغّلها نهائياً ──────────────
  if (req.method === "DELETE") {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "id مطلوب" });
    await writeAll((await readAll()).filter(s => s.id !== id));
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
