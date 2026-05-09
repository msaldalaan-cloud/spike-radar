# SPIKE RADAR — دليل النشر الكامل

## هيكل الملفات
```
/
├── pages/
│   ├── index.jsx          ← الواجهة
│   └── api/
│       ├── scan.js        ← API الفحص
│       ├── strategies.js  ← API الاستراتيجيات (Vercel KV)
│       └── cron.js        ← Cron كل 5 دقائق
├── vercel.json            ← جدول Cron
└── .env.local             ← المتغيرات المحلية
```

## خطوات النشر

### 1. package.json
```json
{
  "name": "spike-radar",
  "scripts": { "dev": "next dev", "build": "next build", "start": "next start" },
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "@vercel/kv": "^1.0.0"
  }
}
```

### 2. رفع على GitHub
```bash
git init && git add . && git commit -m "SPIKE RADAR"
git remote add origin https://github.com/YOUR_USER/spike-radar.git
git push -u origin main
```

### 3. نشر على Vercel
- افتح vercel.com → New Project → اختر الـ repo
- اضغط Deploy

### 4. إضافة Vercel KV (مرة واحدة)
- Vercel Dashboard → Storage → Create → KV Database
- اربطه بمشروعك → Environment Variables تُضاف تلقائياً

### 5. إضافة Environment Variables في Vercel
```
SAHMK_API_KEY         = مفتاح Sahmk الخاص بك
EMAILJS_SERVICE_ID    = service_xxx
EMAILJS_TEMPLATE_ID   = template_xxx
EMAILJS_PUBLIC_KEY    = مفتاحك العام
EMAILJS_TO_EMAIL      = بريدك
CRON_SECRET           = أي نص عشوائي
NEXT_PUBLIC_BASE_URL  = https://your-app.vercel.app
```

### 6. Redeploy بعد إضافة المتغيرات
- Vercel → Deployments → Redeploy

## بعد النشر
- افتح التطبيق
- اضبط إعداداتك واضغط حفظ
- فعّل ✓ الاستراتيجيات للفحص التلقائي
- Vercel Cron يعمل تلقائياً الأحد–الخميس 10:00–15:30

## ملاحظات
- المفاتيح محفوظة في Vercel مرة واحدة للأبد
- الاستراتيجيات محفوظة في Vercel KV (دائمة)
- الإيميل يُرسل تلقائياً عند وجود إشارات فقط
