# 🚀 دليل التعامل مع قاعدة بيانات Supabase (للمطورين ونماذج الذكاء الاصطناعي)
# Supabase Database & Migration Guide for AI Agents & Developers

هذا المستند يُعد المرجع الإلزامي والنهائي لأي نموذج ذكاء اصطناعي (AI Agent) أو مطور يعمل على هذا المشروع. يجب اتباع هذه الخطوات والمعايير بدقة دون أي اجتهاد عشوائي.

---

## 1. بيانات المشروع والربط (Project Configuration)

* **Project Reference ID:** `cwahfoeehmlppifffapx`
* **Region:** `eu-west-1`
* **Project URL:** `https://cwahfoeehmlppifffapx.supabase.co`
* **حالة المشروع:** نشط ومربوط محلياً بالـ CLI (`ACTIVE_HEALTHY`).
* **ملف المتغيرات البيئية:** [.env.local](file:///.env.local)
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

---

## 2. قواعد صارمة لأي نموذج ذكاء اصطناعي (Mandatory AI Rules)

> ⚠️ **تنبيه حاسم لأي AI Agent:**
> 1. **ممنوع تشغيل `supabase db pull`**: المشروع يبدأ من الصفر محلياً، ولا يوجد جداول قديمة للسحب.
> 2. **ممنوع إنشاء الجداول يدوياً بدون مايجريشن**: أي جدول أو تعديل يجب أن يمر عبر ملف SQL داخل `supabase/migrations/`.
> 3. **تفعيل الـ RLS إلزامي**: كل جدول جديد في `public` schema يجب أن يحتوي على `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`.
> 4. **تسمية الحقول:** استخدم `snake_case` دائماً لأسماء الجداول والأعمدة في PostgreSQL.
> 5. **الأمر المعتمد لرفع التعديلات للسيرفر:** هو دائماً `npx supabase db push`.

---

## 3. دورة العمل القياسية لإضافة وتعديل الجداول (Workflow)

### الخطوة 1: التأكد من ربط الـ CLI (مرة واحدة فقط)
المشروع مربوط بالفعل، ولكن للتأكد في أي جلسة عمل جديدة:
```powershell
npx supabase link --project-ref cwahfoeehmlppifffapx
```

---

### الخطوة 2: إنشاء ملف مايجريشن جديد (Create Migration)
لا تقم بإنشاء ملفات SQL عشوائياً، بل استخدم أمر الـ CLI لضمان إعطائه طابع زمني (Timestamp) صحيح:
```powershell
npx supabase migration new <اسم_المايجريشن>

# مثال:
npx supabase migration new create_profiles_table
```
سيقوم الـ CLI بإنشاء ملف في المسار:
`supabase/migrations/<TIMESTAMP>_create_profiles_table.sql`

---

### الخطوة 3: كتابة كود SQL القياسي داخل ملف المايجريشن
افتح الملف المنشأ في `supabase/migrations/` واكتب الـ SQL بالهيكل القياسي التالي:

```sql
-- 1. إنشاء الجدول
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. تفعيل نظام حماية الصفوف (Row Level Security - RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. سياسات الأمان (Policies)
-- السماح للمستخدمين بقراءة بياناتهم أو الحسابات العامة
CREATE POLICY "Public profiles are viewable by everyone" 
ON public.profiles FOR SELECT 
USING (true);

-- السماح للمستخدم فقط بتعديل بياناته الشخصية
CREATE POLICY "Users can update their own profile" 
ON public.profiles FOR UPDATE 
USING (auth.uid() = id);

-- 4. فهارس الأداء (Indexes)
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
```

---

### الخطوة 4: رفع وتطبيق المايجريشن على قاعدة البيانات (Deploy & Push)
لتطبيق الملف الجديد على سيرفر Supabase مباشرة:
```powershell
npx supabase db push
```
عند نجاح الأمر ستظهر رسالة:
`Applying migration <TIMESTAMP>_<name>.sql... Finished supabase db push.`

---

## 4. كيفية الاتصال بقاعدة البيانات من كود Next.js

### 1. تثبيت الحزمة (في حال لم تكن مثبتة):
```powershell
npm install @supabase/supabase-js
```

### 2. إنشاء عميل الاتصال (Supabase Client Singleton):
أنشئ ملفاً في المسار `lib/supabase.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

### 3. مثال لجلب البيانات في صفحات Next.js (App Router):
```typescript
import { supabase } from '@/lib/supabase';

export default async function Page() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*');

  if (error) {
    console.error('Error fetching data:', error);
    return <div>حدث خطأ أثناء تحميل البيانات</div>;
  }

  return (
    <div>
      <h1>قائمة البيانات</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
```

---

## 5. الأوامر السريعة الملخصة (Cheat Sheet)

| المهمة | الأمر |
| :--- | :--- |
| **التأكد من قائمة المشاريع** | `npx supabase projects list` |
| **ربط المشروع بالـ CLI** | `npx supabase link --project-ref cwahfoeehmlppifffapx` |
| **إنشاء ملف مايجريشن جديد** | `npx supabase migration new <migration_name>` |
| **رفع وتطبيق المايجريشن للسيرفر** | `npx supabase db push` |
| **توليد أنواع TypeScript تلقائياً** | `npx supabase gen types typescript --linked > types/supabase.ts` |
