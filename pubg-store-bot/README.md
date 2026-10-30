# pubg-store-bot

بوت تلغرام لقنوات بيع حسابات ببجي. البائع يبقى مخفي تمامًا، والإعلان ينزل باسم مالك القناة فقط. البيع والتسليم عبر المالك.

> المشروع مكتمل حتى **المرحلة 7 (الإنتاج)**. لا يُنشر على سيرفر تلقائيًا؛ الخطوات أدناه للتطبيق يدويًا.

## المتطلبات

- Node.js 20+
- Docker Desktop (PostgreSQL + Redis)
- توكن بوت من [@BotFather](https://t.me/BotFather)

## إعداد تلغرام (BotFather والقناة)

1. افتح [@BotFather](https://t.me/BotFather) وأرسل `/newbot`، ثم خذ التوكن وضعه في `BOT_TOKEN`.
2. أوقف Privacy Mode إن حبيت البوت يقرأ رسائل القناة لاحقًا: `/setprivacy` → Disable.
3. أنشئ قناة بيع (أو استخدم قناة موجودة).
4. أضف البوت **أدمن** في القناة، مع صلاحية نشر الرسائل وتعديلها وحذفها.
5. لمعرفة `DEFAULT_CHANNEL_ID`: أعد توجيه رسالة من القناة إلى [@userinfobot](https://t.me/userinfobot) (شكلها `-100…`).
6. لمعرفة `OWNER_TELEGRAM_ID`: راسل نفس البوت، هذا آيديك الرقمي.
7. `OWNER_USERNAME` يوزرك بدون `@` — هذا اللي يظهر في الإعلان للزبائن.

## التشغيل المحلي

1. انسخ الإعدادات:

```bash
cp .env.example .env
```

2. عدّل `.env`: `BOT_TOKEN` و`DEFAULT_CHANNEL_ID` و`OWNER_TELEGRAM_ID` و`OWNER_USERNAME`. اترك `WEBHOOK_URL` فارغًا حتى يستخدم البوت polling.

3. شغّل القاعدة وRedis:

```bash
docker compose up -d postgres redis
```

4. ثبّت الاعتماديات وطبّق الجداول:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
```

5. شغّل البوت:

```bash
npm run dev
```

أو البوت داخل Docker مع الخدمات:

```bash
docker compose --profile app up --build
```

الصفحة التعريفية: `http://127.0.0.1:3780/`
لوحة المالك: `http://127.0.0.1:3780/dashboard` — ضع `DASHBOARD_TOKEN` وادخل من النموذج، أو `/dashboard/login?token=...`

فحص الصحة: `http://127.0.0.1:3780/health` و`/ready`

## كيف تجرب المسارات

**بائع:** `/start` → فيديو الحساب → وصف حر (لفل، سكنات، ربط، سعر) → معاينة نشر/تعديل/إلغاء. الإعلان ينزل باسم المالك فقط.

**مالك:** `/sold A001` و`/delete A001`. إذا الرسوم أكبر من صفر يوصلك إيصال للتأكيد قبل النشر.

**مشتري:** `A001 موجود؟` أو تحويل رسالة القناة. البائع ينسأل دون كشف الأطراف، والنتيجة ترجع للمشتري ويُحوَّل للمالك.

**ذكاء اصطناعي:** ضع `OPENAI_API_KEY` أو اتركه فارغًا للمنطق الاحتياطي.

**تعدد المتاجر:** `/setup` و`/settings` و`/stats`.

**حماية:** إعادة نفس الحساب تحدث السعر بدل إعلان مكرر. `/ban` و`/unban` و`/audit`. حد يومي وrate limit.

## الأوامر

| الأمر | من | الوظيفة |
| --- | --- | --- |
| `/start` | البائع / المالك | بدء عرض حساب |
| `/cancel` | أي شخص | إلغاء العملية الحالية |
| `/sold A123` | المالك | تعليم الإعلان مباعًا |
| `/delete A123` | المالك | حذف الإعلان |
| `/ban A123` | المالك | حظر بائع الإعلان |
| `/unban 123456789` | المالك | فك الحظر |
| `/audit` | المالك | آخر عمليات التدقيق |
| `/setup` | المالك | إضافة قناة/متجر |
| `/settings` | المالك | إعدادات المتجر |
| `/stats` | المالك | إحصائيات المتجر |
| `A123 موجود؟` أو تحويل الإعلان | المشتري | سؤال عن التوفر |

## الاختبارات

```bash
npm test
```

## النشر على سيرفر (يدويًا)

الدومين المضبوط: **getsarh.tech**. Caddy يستقبل 80/443 ويحوّل إلى البوت، والويبهوك يكون `https://getsarh.tech/telegram/webhook`.

لا يُرفع المشروع على سيرفر من هنا. على VPS:

1. انسخ المشروع (`git clone` من الريبو الخاص).
2. أنشئ `.env` من `.env.example` واملأ المفاتيح. غيّر `POSTGRES_PASSWORD` و`WEBHOOK_SECRET`. تأكد:

```env
DOMAIN=getsarh.tech
NODE_ENV=production
BOT_USERNAME=your_bot_username
```

`WEB_PUBLIC_URL` و`WEBHOOK_URL` ينضبطان تلقائيًا في `docker-compose.prod.yml`.

3. وجّه سجل **A** للدومين `getsarh.tech` إلى IP السيرفر (من لوحة الدومين أو Cloudflare).

4. شغّل الإنتاج:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

البوت يسجّل webhook على `https://getsarh.tech/telegram/webhook`. PostgreSQL وRedis غير مكشوفين خارج الشبكة.

5. تأكد:

```bash
curl https://getsarh.tech/health
curl https://getsarh.tech/ready
```

6. النسخ الاحتياطي (يوميا عبر cron):

```bash
sh scripts/backup-db.sh
```

الملفات تُحفظ في `backups/` مضغوطة، ويُحذف الأقدم بعد 14 نسخة. الاستعادة:

```bash
gunzip -c backups/pubg_store_YYYYMMDDTHHMMSSZ.sql.gz | docker compose -f docker-compose.prod.yml exec -T postgres psql -U pubg pubg_store
```

السجلات JSON عبر Docker (`json-file`، حد 10MB × 5 ملفات):

```bash
docker compose -f docker-compose.prod.yml logs -f bot
```

## متغيرات البيئة المهمة

| المتغير | الوظيفة |
| --- | --- |
| `BOT_TOKEN` | توكن BotFather |
| `DATABASE_URL` / `REDIS_URL` | الاتصالات |
| `DEFAULT_CHANNEL_ID` | القناة الافتراضية |
| `OWNER_TELEGRAM_ID` / `OWNER_USERNAME` | المالك |
| `LISTING_FEE` | رسوم الإعلان الافتراضية (0 = مجاني) |
| `WEBHOOK_URL` | فارغ = polling. HTTPS كامل = إنتاج |
| `WEBHOOK_SECRET` | سر تحقق طلبات تلغرام |
| `OPENAI_API_KEY` | اختياري |

لا ترفع ملف `.env` إلى GitHub.

## التقنية

Node.js 20، TypeScript، grammY (polling أو webhook)، PostgreSQL + Prisma، Redis + BullMQ، OpenAI، satori، Vitest، Docker Compose.
