import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import * as XLSX from 'xlsx';

// ── Types ──
type AnyRecord = Record<string, unknown>;

const sr = (record: AnyRecord): AnyRecord => {
  const v = record.search_result;
  return (v && typeof v === 'object' && !Array.isArray(v)) ? (v as AnyRecord) : {};
};

const nested = (obj: AnyRecord, key: string): AnyRecord => {
  const v = obj[key];
  return (v && typeof v === 'object' && !Array.isArray(v)) ? (v as AnyRecord) : {};
};

const str = (v: unknown): string => (v != null && v !== '' ? String(v).trim() : '—');

// ══════════════════════════════════════════════════════════════════
// PURPOSE_LABELS: المسميات الرسمية لأغراض العمليات
// ══════════════════════════════════════════════════════════════════
const PURPOSE_LABELS: Record<string, string> = {
  general: 'بحث عام 🔍',
  s1: 'س1 — تسجيل جديد 📋',
  s6: 'س6 — إنهاء اشتراك 🔴',
  details: 'تفاصيل كاملة 👤',
  discrepancy: 'شيت المناقضات ⚠️',
  supplied: 'تم التوريد 📤',
  archives: 'الأرشيف 📁',
};

// ══════════════════════════════════════════════════════════════════
// fullDate & extractExactDate: استخراج وحل التواريخ بدقة يوم/شهر/سنة
// ══════════════════════════════════════════════════════════════════
const ARABIC_MONTHS: Record<string, number> = {
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4,
  'مايو': 5, 'يونيو': 6, 'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8,
  'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
};

// يستخرج التاريخ الكامل إذا كان يحتوي على يوم وشهر وسنة (DD/MM/YYYY أو YYYY-MM-DD)
function extractExactDate(v: unknown): string {
  if (v == null || v === '' || v === '—') return '';
  const s = String(v).trim();
  if (!s || s === '—') return '';

  // بحث عن DD/MM/YYYY أو D/M/YYYY داخل أي نص
  const dmy = s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (dmy) {
    const d = dmy[1].padStart(2, '0');
    const m = dmy[2].padStart(2, '0');
    const y = dmy[3];
    return `${d}/${m}/${y}`;
  }

  // بحث عن YYYY-MM-DD
  const ymd = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  }

  return '';
}

function fullDate(v: unknown): string {
  if (v == null || v === '' || v === '—') return '—';
  const raw = String(v).trim();
  if (!raw || raw === '—') return '—';

  // 1. إذا كان يحتوي على تاريخ كامل صريح
  const exact = extractExactDate(raw);
  if (exact) return exact;

  // 2. YYYY-MM (شهر/سنة فقط → يوم = 01)
  const isoMonth = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (isoMonth) {
    const m = isoMonth[2].padStart(2, '0');
    return `01/${m}/${isoMonth[1]}`;
  }

  // 3. MM/YYYY or M/YYYY
  const slashMonth = raw.match(/^(\d{1,2})\/(\d{4})$/);
  if (slashMonth) {
    const m = slashMonth[1].padStart(2, '0');
    return `01/${m}/${slashMonth[2]}`;
  }

  // 4. Arabic month name: "يناير 2026" or "2026 يناير"
  for (const [name, num] of Object.entries(ARABIC_MONTHS)) {
    if (raw.includes(name)) {
      const yearMatch = raw.match(/(\d{4})/);
      if (yearMatch) {
        const m = String(num).padStart(2, '0');
        return `01/${m}/${yearMatch[1]}`;
      }
    }
  }

  return raw;
}

// ══════════════════════════════════════════════════════════════════
// حل تاريخ بداية الاشتراك (س1) مع إعطاء الأولوية القصوى للتاريخ المحسوب الفعلي
// ══════════════════════════════════════════════════════════════════
function resolveS1StartDate(result: AnyRecord, rec: AnyRecord, s1Info: AnyRecord): string {
  // أولوية 1: التاريخ المعدل يدوياً إن وُجد تاريخ كامل صريح
  const manual = extractExactDate(result.subscription_start_date);
  if (manual) return manual;

  // أولوية 2: التاريخ المحسوب بالمعادلة الفعلية من الحضور (s1_info.calculatedDate أو recordedDate)
  const calc = extractExactDate(s1Info.calculatedDate) || extractExactDate(s1Info.recordedDate);
  if (calc) return calc;

  // أولوية 3: استخراج من نص المعادلة أو رسالة س1
  const fromFormula = extractExactDate(s1Info.formula) || extractExactDate(s1Info.message);
  if (fromFormula) return fromFormula;

  // أولوية 4: إذا كان مسجل كشهر وسنة فقط في أول ظهور أو الاشتراك
  if (result.subscription_start_date) return fullDate(result.subscription_start_date);
  if (result.first_both_month) return fullDate(result.first_both_month);
  if (rec.first_both_month) return fullDate(rec.first_both_month);

  return '—';
}

// ══════════════════════════════════════════════════════════════════
// حل تاريخ نهاية الاشتراك (س6) باليوم والشهر والسنة
// ══════════════════════════════════════════════════════════════════
function resolveS6EndDate(result: AnyRecord, rec: AnyRecord, s6Info: AnyRecord, cl: AnyRecord): string {
  // أولوية 1: التاريخ المحسوب أو المسجل بالاستقالات (s6_info.calculatedDate أو recordedDate أو lastWorkingDay)
  const calc = extractExactDate(s6Info.calculatedDate) || extractExactDate(s6Info.recordedDate) || extractExactDate(s6Info.lastWorkingDay);
  if (calc) return calc;

  // أولوية 2: تاريخ التوريد من الشيك ليست
  const clDate = extractExactDate(cl.res_supply_date);
  if (clDate) return clDate;

  // أولوية 3: استخراج من نص رسالة أو ملاحظات س6
  const fromMsg = extractExactDate(s6Info.formula) || extractExactDate(s6Info.message) || extractExactDate(cl.res_notes);
  if (fromMsg) return fromMsg;

  return '—';
}

// ══════════════════════════════════════════════════════════════════
// حل تاريخ بداية أو نهاية الاشتراك (النشط حسب العملية وحالة الموظف)
// ══════════════════════════════════════════════════════════════════
function resolveActiveSubscriptionDate(result: AnyRecord, rec: AnyRecord, s1Info: AnyRecord, s6Info: AnyRecord, cl: AnyRecord): string {
  const isResigned = Boolean(rec.has_resignation || str(result._search_purpose) === 's6' || cl.res_ready_for_s6 || cl.res_supplied_s6);
  if (isResigned) {
    const s6Date = resolveS6EndDate(result, rec, s6Info, cl);
    if (s6Date !== '—') return s6Date;
  }
  return resolveS1StartDate(result, rec, s1Info);
}

// ══════════════════════════════════════════════════════════════════
// حل عمود "التفاصيل والملاحظات" (مطابق 100% لما يظهر في جدول الواجهة)
// ══════════════════════════════════════════════════════════════════
function resolveDetailsAndNotes(rec: AnyRecord, result: AnyRecord, s1Info: AnyRecord, s6Info: AnyRecord, cl: AnyRecord): string {
  // 1. مناقضة
  const disc = str(cl.discrepancy_note || rec.discrepancy_note);
  if (disc && disc !== '—') return disc;

  // 2. جاهزية س1
  const s1Date = extractExactDate(s1Info.calculatedDate) || extractExactDate(s1Info.recordedDate) || str(s1Info.calculatedDate || s1Info.recordedDate);
  if (s1Info.status === 'calculated' && s1Date) {
    return `جاهز س1 (${s1Date})`;
  } else if (s1Info.status === 'recorded' && s1Date) {
    return `مسجل س1 (${s1Date})`;
  } else if (s1Info.status === 'manual_review') {
    return 'س1 يحتاج مراجعة';
  } else if (s1Date) {
    return `جاهز س1 (${s1Date})`;
  }

  // 3. جاهزية س6
  const s6Date = extractExactDate(s6Info.calculatedDate) || extractExactDate(s6Info.recordedDate) || extractExactDate(s6Info.lastWorkingDay) || str(s6Info.calculatedDate || s6Info.recordedDate);
  if (cl.res_supplied_s6) {
    return `س6 تم التوريد فعلياً${s6Date ? ` (${s6Date})` : ''}`;
  } else if (cl.res_ready_for_s6) {
    return `جاهز س6 للتوريد${s6Date ? ` (${s6Date})` : ''}`;
  } else if (rec.has_resignation) {
    return `مسجل بالاستقالات${s6Date ? ` (${s6Date})` : ''}`;
  }

  // 4. ملاحظات الشيك ليست
  const note = str(cl.checklist_note);
  if (note && note !== '—') return note;

  return '—';
}

// formatTimestamp: يحوّل search_timestamp إلى تاريخ ووقت كامل عربي
function formatTimestamp(ts: unknown): string {
  if (!ts) return '—';
  try {
    const d = new Date(String(ts));
    if (isNaN(d.getTime())) return String(ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return String(ts);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    return handleExport(request, body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء تصدير سجل البحث';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    return handleExport(request, {});
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء تصدير سجل البحث';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleExport(request: NextRequest, body: AnyRecord) {
  const { searchParams } = new URL(request.url);

  // Parameters from body or searchParams
  const purposeParam = String(body.purpose || searchParams.get('purpose') || '').toLowerCase().trim();
  const uniqueOnly = (body.unique !== undefined ? Boolean(body.unique) : searchParams.get('unique') !== 'false');
  const dateFilter = String(body.date || searchParams.get('date') || '').trim();

  // IDs filter for checked items
  let targetIds: string[] = [];
  if (Array.isArray(body.ids)) {
    targetIds = body.ids.map(String);
  } else if (searchParams.get('ids')) {
    targetIds = searchParams.get('ids')!.split(',').map((s) => s.trim()).filter(Boolean);
  }

  // 1. Fetch search history records
  let query = supabaseServer
    .from('search_history')
    .select('*')
    .eq('result_found', true)
    .order('search_timestamp', { ascending: false });

  if (targetIds.length > 0) {
    query = query.in('id', targetIds);
  }

  const { data: rawHistory, error } = await query.limit(targetIds.length > 0 ? targetIds.length : 2000);

  if (error) {
    throw new Error(`فشل جلب سجل البحث: ${error.message}`);
  }

  if (!rawHistory || rawHistory.length === 0) {
    return NextResponse.json({
      success: false,
      error: 'لا توجد سجلات مطابقة للتصدير',
    }, { status: 404 });
  }

  // 2. Filter by date if requested
  let filtered = rawHistory;
  if (dateFilter === 'today') {
    const todayStr = new Date().toISOString().split('T')[0];
    filtered = filtered.filter((r) => r.search_timestamp && r.search_timestamp.startsWith(todayStr));
  } else if (dateFilter === 'yesterday') {
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const yestStr = yest.toISOString().split('T')[0];
    filtered = filtered.filter((r) => r.search_timestamp && r.search_timestamp.startsWith(yestStr));
  }

  // 3. Deduplicate by employee key if uniqueOnly is requested and no specific IDs targeted
  if (uniqueOnly && targetIds.length === 0) {
    const uniqueMap = new Map<string, typeof rawHistory[0]>();
    for (const record of filtered) {
      const key = record.national_id || record.employee_code || record.employee_name;
      if (key && !uniqueMap.has(key)) {
        uniqueMap.set(key, record);
      }
    }
    filtered = Array.from(uniqueMap.values());
  }

  // 4. Filter by purpose if not 'all' and not empty (only when no explicit IDs are chosen)
  if (targetIds.length === 0 && purposeParam && purposeParam !== 'all') {
    if (purposeParam === 's1') {
      filtered = filtered.filter((r) => {
        const result = sr(r as AnyRecord);
        const recordPurpose = String(result._search_purpose || '').toLowerCase();
        const s1Info = nested(result, 's1_info');
        const st = String(r.insurance_status || '');
        return recordPurpose === 's1' || s1Info.status === 'calculated' || s1Info.status === 'recorded' || st.includes('تجهيز') || st.includes('جاري');
      });
    } else if (purposeParam === 's6') {
      filtered = filtered.filter((r) => {
        const result = sr(r as AnyRecord);
        const recordPurpose = String(result._search_purpose || '').toLowerCase();
        const cl = nested(result, 'checklist_action');
        return recordPurpose === 's6' || r.has_resignation === true || !!cl.res_ready_for_s6 || !!cl.res_supplied_s6;
      });
    } else if (purposeParam === 'discrepancy' || purposeParam === 'مناقضة') {
      filtered = filtered.filter((r) => {
        const result = sr(r as AnyRecord);
        const cl = nested(result, 'checklist_action');
        const st = String(cl.insurance_status || r.insurance_status || '');
        const note = String(cl.discrepancy_note || '');
        return st.includes('مناقضة') || (note !== '—' && note.trim().length > 0);
      });
    } else if (purposeParam === 'supplied' || purposeParam === 'تم التوريد') {
      filtered = filtered.filter((r) => {
        const result = sr(r as AnyRecord);
        const cl = nested(result, 'checklist_action');
        const st = String(cl.insurance_status || r.insurance_status || '');
        return st.includes('توريد') || !!cl.res_supplied_s6 || cl.archives_supply_status === 'تم التوريد';
      });
    } else if (purposeParam === 'archives') {
      filtered = filtered.filter((r) => {
        const result = sr(r as AnyRecord);
        const cl = nested(result, 'checklist_action');
        const docs = nested(cl, 'archives_docs') as Record<string, boolean>;
        return cl.archives_supply_status || Object.keys(docs).length > 0;
      });
    } else if (purposeParam === 'details') {
      filtered = filtered.filter((r) => {
        const result = sr(r as AnyRecord);
        return result._search_purpose === 'details' || !purposeParam;
      });
    } else if (purposeParam === 'general') {
      filtered = filtered.filter((r) => {
        const result = sr(r as AnyRecord);
        const recordPurpose = String(result._search_purpose || 'general').toLowerCase();
        return recordPurpose === 'general' || !result._search_purpose;
      });
    }
  }

  if (filtered.length === 0) {
    return NextResponse.json({
      success: false,
      error: `لا توجد سجلات مطابقة للغرض المحدد (${purposeParam})`,
    }, { status: 404 });
  }

  // 5. Generate Excel workbook customized to the purpose!
  const workbook = XLSX.utils.book_new();
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const hours = now.getHours().toString().padStart(2, '0');
  const mins = now.getMinutes().toString().padStart(2, '0');
  const isCheckedOnly = targetIds.length > 0;

  let defaultFilename = '';

  // ── Mode 1: س1 — تسجيل جديد ──
  if (purposeParam === 's1') {
    defaultFilename = isCheckedOnly
      ? `سجل_س1_المحدد_${dateStr}_${hours}-${mins}.xlsx`
      : `سجل_استمارات_س1_${dateStr}_${hours}-${mins}.xlsx`;

    const s1Rows = filtered.map((record, index) => {
      const rec = record as AnyRecord;
      const result = sr(rec);
      const s1Info = nested(result, 's1_info');
      const s6Info = nested(result, 's6_info');
      const cl = nested(result, 'checklist_action');

      const s1StartDate = resolveS1StartDate(result, rec, s1Info);
      const details = resolveDetailsAndNotes(rec, result, s1Info, s6Info, cl);

      const s1Status = str(s1Info.status);
      let s1Readiness = '—';
      if (s1Status === 'calculated') s1Readiness = `جاهز لتوريد س1 (${s1StartDate})`;
      else if (s1Status === 'recorded') s1Readiness = `مسجل بالدفاتر (${s1StartDate})`;
      else if (s1Status === 'manual_review') s1Readiness = 'يحتاج مراجعة يدوية';
      else if (s1Status === 'insufficient_data') s1Readiness = 'بيانات ناقصة';
      else if (s1StartDate !== '—') s1Readiness = `جاهز س1 (${s1StartDate})`;

      return {
        'م': index + 1,
        'اسم الموظف': str(rec.employee_name),
        'كود الموظف': str(rec.employee_code),
        'الرقم القومي': str(rec.national_id),
        'الرقم التأميني': str(result.insurance_number),
        'مهنة التأمينات': str(result.insurance_job_title),
        'تاريخ بداية الاشتراك (س1)': s1StartDate,
        'جاهزية استمارة س1': s1Readiness,
        'التفاصيل والملاحظات': details,
        'الحالة التأمينية': str(cl.insurance_status || rec.insurance_status || 'تم التجهيز'),
        'الشركة (Account)': str(rec.company_account || result.company_account),
        'الوظيفة الفعلية': str(result.job_title),
        'رقم الهاتف': str(result.phone_number),
        'أول ظهور مشترك': fullDate(rec.first_both_month),
        'أيام الحضور': str(rec.attendance_days),
        'ملاحظات': str(cl.checklist_note),
        'تاريخ ووقت الإجراء': formatTimestamp(rec.search_timestamp),
      };
    });

    const sheet = XLSX.utils.json_to_sheet(s1Rows);
    sheet['!views'] = [{ showGridLines: true }];
    sheet['!cols'] = [
      { wch: 5 }, { wch: 34 }, { wch: 14 }, { wch: 18 }, { wch: 16 },
      { wch: 22 }, { wch: 24 }, { wch: 26 }, { wch: 26 }, { wch: 18 },
      { wch: 16 }, { wch: 22 }, { wch: 16 }, { wch: 18 }, { wch: 12 },
      { wch: 26 }, { wch: 22 }
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, 'استمارات سن 1 - تسجيل جديد');
  }

  // ── Mode 2: س6 — إنهاء اشتراك ──
  else if (purposeParam === 's6') {
    defaultFilename = isCheckedOnly
      ? `سجل_س6_المحدد_${dateStr}_${hours}-${mins}.xlsx`
      : `سجل_استمارات_س6_${dateStr}_${hours}-${mins}.xlsx`;

    const s6Rows = filtered.map((record, index) => {
      const result = sr(record as AnyRecord);
      const rec = record as AnyRecord;
      const s1Info = nested(result, 's1_info');
      const s6Info = nested(result, 's6_info');
      const cl = nested(result, 'checklist_action');

      let s6Action = '—';
      if (cl.res_supplied_s6) s6Action = 'تم التوريد فعلياً';
      else if (cl.res_ready_for_s6) s6Action = 'جاهز للتوريد (تم التجهيز)';
      else if (record.has_resignation) s6Action = 'مسجل في شيت RES';

      const s6EndDate = resolveS6EndDate(result, rec, s6Info, cl);
      const details = resolveDetailsAndNotes(rec, result, s1Info, s6Info, cl);

      return {
        'م': index + 1,
        'اسم الموظف': str(rec.employee_name),
        'كود الموظف': str(rec.employee_code),
        'الرقم القومي': str(rec.national_id),
        'الرقم التأميني': str(result.insurance_number),
        'حالة استمارة س6': s6Action,
        'تاريخ نهاية الاشتراك (س6)': s6EndDate,
        'تاريخ الاستقالة': fullDate(s6Info.recordedDate),
        'آخر يوم عمل': fullDate(s6Info.lastWorkingDay || s6EndDate),
        'التفاصيل والملاحظات': details,
        'تاريخ توريد س6': fullDate(cl.res_supply_date || cl.archives_supply_date),
        'نوع توريد تأمينات (RES)': str(cl.res_supply_type || 'يدوي'),
        'الشركة (Account)': str(rec.company_account),
        'الوظيفة': str(result.job_title),
        'ملاحظات الاستقالة': str(cl.res_notes || s6Info.message),
        'تاريخ ووقت الإجراء': formatTimestamp(rec.search_timestamp),
      };
    });

    const sheet = XLSX.utils.json_to_sheet(s6Rows);
    sheet['!views'] = [{ showGridLines: true }];
    sheet['!cols'] = [
      { wch: 5 }, { wch: 34 }, { wch: 14 }, { wch: 18 }, { wch: 16 },
      { wch: 25 }, { wch: 24 }, { wch: 16 }, { wch: 16 }, { wch: 26 },
      { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 24 }, { wch: 30 },
      { wch: 22 }
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, 'استمارات سن 6 - إنهاء اشتراك');
  }

  // ── Mode 3: شيت المناقضات ──
  else if (purposeParam === 'discrepancy' || purposeParam === 'مناقضة') {
    defaultFilename = isCheckedOnly
      ? `شيت_المناقضات_المحدد_${dateStr}_${hours}-${mins}.xlsx`
      : `شيت_المناقضات_${dateStr}_${hours}-${mins}.xlsx`;

    const discRows = filtered.map((record, index) => {
      const result = sr(record as AnyRecord);
      const rec = record as AnyRecord;
      const cl = nested(result, 'checklist_action');
      const note = str(cl.discrepancy_note);

      return {
        'م': index + 1,
        'كود الموظف': str(rec.employee_code),
        'اسم الموظف': str(rec.employee_name),
        'الرقم القومي': str(rec.national_id),
        'الرقم التأميني': str(result.insurance_number),
        'نوع / سبب المناقضة (المستند الناقص)': note !== '—' ? note : 'نقص استيفاء أوراق / مراجعة',
        'الحالة التأمينية': 'مناقضة',
        'الشركة (Account)': str(rec.company_account),
        'الوظيفة': str(result.job_title),
        'رقم الهاتف': str(result.phone_number),
        'ملاحظات الاستيفاء': str(cl.checklist_note),
        'تاريخ رصد المناقضة': formatTimestamp(rec.search_timestamp),
      };
    });

    const sheet = XLSX.utils.json_to_sheet(discRows);
    sheet['!views'] = [{ showGridLines: true }];
    sheet['!cols'] = [
      { wch: 5 }, { wch: 14 }, { wch: 34 }, { wch: 18 }, { wch: 16 },
      { wch: 38 }, { wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 16 }, { wch: 25 }, { wch: 22 }
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, 'شيت المناقضات');
  }

  // ── Mode 4: تم التوريد (أرقام وارد التأمين) ──
  else if (purposeParam === 'supplied' || purposeParam === 'تم التوريد') {
    defaultFilename = isCheckedOnly
      ? `أرقام_وارد_التأمين_المحدد_${dateStr}_${hours}-${mins}.xlsx`
      : `أرقام_وارد_التأمين_تم_التوريد_${dateStr}_${hours}-${mins}.xlsx`;

    const suppliedRows = filtered.map((record, index) => {
      const result = sr(record as AnyRecord);
      const rec = record as AnyRecord;
      const cl = nested(result, 'checklist_action');

      return {
        'م': index + 1,
        'كود الموظف': str(rec.employee_code),
        'اسم الموظف': str(rec.employee_name),
        'الرقم القومي': str(rec.national_id),
        'الرقم التأميني': str(result.insurance_number),
        'حالة التوريد': 'تم التوريد',
        'تاريخ التوريد': fullDate(cl.res_supply_date || cl.archives_supply_date),
        'نوع التوريد': str(cl.res_supply_type || 'يدوي'),
        'تأشيرة وارد التأمينات': str(cl.insurance_status || 'تم التوريد'),
        'الشركة (Account)': str(rec.company_account),
        'الوظيفة': str(result.job_title),
        'رقم الهاتف': str(result.phone_number),
        'تاريخ ووقت الإجراء': formatTimestamp(rec.search_timestamp),
      };
    });

    const sheet = XLSX.utils.json_to_sheet(suppliedRows);
    sheet['!views'] = [{ showGridLines: true }];
    sheet['!cols'] = [
      { wch: 5 }, { wch: 14 }, { wch: 34 }, { wch: 18 }, { wch: 16 },
      { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 22 }, { wch: 16 },
      { wch: 22 }, { wch: 16 }, { wch: 22 }
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, 'أرقام وارد التأمين');
  }

  // ── Mode 5: الأرشيف والمستندات ──
  else if (purposeParam === 'archives') {
    defaultFilename = isCheckedOnly
      ? `سجل_الأرشيف_المحدد_${dateStr}_${hours}-${mins}.xlsx`
      : `سجل_الأرشيف_والمستندات_${dateStr}_${hours}-${mins}.xlsx`;

    const archRows = filtered.map((record, index) => {
      const result = sr(record as AnyRecord);
      const rec = record as AnyRecord;
      const cl = nested(result, 'checklist_action');
      const docs = nested(cl, 'archives_docs') as Record<string, boolean>;

      const docKeys = ['contract', 'idCard', 'qualification', 'military', 'birthCertificate', 'workPermit', 'criminalRecord', 'photos', 'skillTest', 'scan'];
      const presentCount = docKeys.filter((k) => docs[k]).length;
      const compPct = `${Math.round((presentCount / docKeys.length) * 100)}%`;

      return {
        'م': index + 1,
        'كود الموظف': str(rec.employee_code),
        'اسم الموظف': str(rec.employee_name),
        'الرقم القومي': str(rec.national_id),
        'حالة التوريد': str(cl.archives_supply_status),
        'تاريخ التوريد': fullDate(cl.archives_supply_date),
        'نسبة الاستيفاء': compPct,
        'العقد': docs.contract ? 'يوجد ✓' : 'ناقص ✗',
        'صورة البطاقة': docs.idCard ? 'يوجد ✓' : 'ناقص ✗',
        'المؤهل': docs.qualification ? 'يوجد ✓' : 'ناقص ✗',
        'الجيش': docs.military ? 'يوجد ✓' : 'ناقص ✗',
        'شهادة الميلاد': docs.birthCertificate ? 'يوجد ✓' : 'ناقص ✗',
        'كعب العمل': docs.workPermit ? 'يوجد ✓' : 'ناقص ✗',
        'الفيش الجنائي': docs.criminalRecord ? 'يوجد ✓' : 'ناقص ✗',
        'الصور الشخصية': docs.photos ? 'يوجد ✓' : 'ناقص ✗',
        'قياس مهارة': docs.skillTest ? 'يوجد ✓' : 'ناقص ✗',
        'Scan': docs.scan ? 'يوجد ✓' : 'ناقص ✗',
        'ملاحظات الأرشيف': str(cl.checklist_note),
        'تاريخ الإجراء': formatTimestamp(rec.search_timestamp),
      };
    });

    const sheet = XLSX.utils.json_to_sheet(archRows);
    sheet['!views'] = [{ showGridLines: true }];
    sheet['!cols'] = [
      { wch: 5 }, { wch: 14 }, { wch: 34 }, { wch: 18 }, { wch: 16 }, { wch: 16 },
      { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
      { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 25 }, { wch: 22 }
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, 'الأرشيف والمستندات');
  }

  // ── Mode 6: تفاصيل موظف كاملة ──
  else if (purposeParam === 'details') {
    defaultFilename = isCheckedOnly
      ? `تفاصيل_الموظفين_المحدد_${dateStr}_${hours}-${mins}.xlsx`
      : `تفاصيل_الموظفين_الشاملة_${dateStr}_${hours}-${mins}.xlsx`;

    const detailRows = filtered.map((record, index) => {
      const result = sr(record as AnyRecord);
      const rec = record as AnyRecord;
      const cl = nested(result, 'checklist_action');
      const s1Info = nested(result, 's1_info');
      const s6Info = nested(result, 's6_info');

      const s1StartDate = resolveS1StartDate(result, rec, s1Info);
      const s6EndDate = resolveS6EndDate(result, rec, s6Info, cl);
      const activeSubscriptionDate = resolveActiveSubscriptionDate(result, rec, s1Info, s6Info, cl);
      const details = resolveDetailsAndNotes(rec, result, s1Info, s6Info, cl);

      return {
        'م': index + 1,
        'اسم الموظف': str(rec.employee_name),
        'كود الموظف': str(rec.employee_code),
        'الرقم القومي': str(rec.national_id),
        'الرقم التأميني': str(result.insurance_number),
        'مهنة التأمينات': str(result.insurance_job_title),
        'الوظيفة الفعلية': str(result.job_title),
        'الشركة (Account)': str(rec.company_account),
        'رقم الهاتف': str(result.phone_number),
        'الحالة التأمينية': str(cl.insurance_status || rec.insurance_status || 'تم التجهيز'),
        'تاريخ بداية الاشتراك (س1)': s1StartDate,
        'جاهزية س1': str(s1Info.status === 'calculated' ? `جاهز (${s1StartDate})` : s1Info.recordedDate ? `مسجل (${s1StartDate})` : '—'),
        'تاريخ نهاية الاشتراك (س6)': s6EndDate,
        'جاهزية س6': str(s6Info.status === 'calculated' ? `جاهز (${s6EndDate})` : rec.has_resignation ? 'مستقيل' : 'مستمر'),
        'آخر يوم عمل (س6)': fullDate(s6Info.lastWorkingDay || s6EndDate),
        'التفاصيل والملاحظات': details,
        'استيفاء الأرشيف': str(cl.archives_supply_status || '—'),
        'أيام الحضور': str(rec.attendance_days),
        'ملاحظات': str(cl.checklist_note || cl.discrepancy_note),
        'تاريخ ووقت الاستدعاء': formatTimestamp(rec.search_timestamp),
      };
    });

    const sheet = XLSX.utils.json_to_sheet(detailRows);
    sheet['!views'] = [{ showGridLines: true }];
    sheet['!cols'] = [
      { wch: 5 }, { wch: 34 }, { wch: 14 }, { wch: 18 }, { wch: 16 },
      { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 18 },
      { wch: 24 }, { wch: 26 }, { wch: 24 }, { wch: 24 }, { wch: 20 },
      { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 26 }, { wch: 22 }
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, 'تفاصيل الموظفين');
  }

  // ── Mode 7: بحث عام أو الكل ──
  else {
    const purposePrefix = isCheckedOnly ? 'سجل_المحدد' : 'سجل_العمليات_الشامل';
    defaultFilename = `${purposePrefix}_${dateStr}_${hours}-${mins}.xlsx`;

    const generalRows = filtered.map((record, index) => {
      const rec = record as AnyRecord;
      const result = sr(rec);
      const cl = nested(result, 'checklist_action');
      const s1Info = nested(result, 's1_info');
      const s6Info = nested(result, 's6_info');

      const activeSubscriptionDate = resolveActiveSubscriptionDate(result, rec, s1Info, s6Info, cl);
      const details = resolveDetailsAndNotes(rec, result, s1Info, s6Info, cl);
      const purpose = str(result._search_purpose) || 'general';
      const purposeLabel = PURPOSE_LABELS[purpose] || purpose;

      return {
        'م': index + 1,
        'اسم الموظف': str(rec.employee_name),
        'كود الموظف': str(rec.employee_code),
        'الرقم القومي': str(rec.national_id),
        'الرقم التأميني': str(result.insurance_number),
        'مهنة التأمينات': str(result.insurance_job_title),
        'الوظيفة الفعلية': str(result.job_title),
        'الشركة (Account)': str(rec.company_account),
        'غرض العملية': purposeLabel,
        'الحالة التأمينية': str(cl.insurance_status || rec.insurance_status || 'تم التجهيز'),
        'تاريخ بداية أو نهاية الاشتراك': activeSubscriptionDate,
        'التفاصيل والملاحظات': details,
        'الحالة الوظيفية': str(rec.status),
        'أيام الحضور': str(rec.attendance_days),
        'مستقيل؟': rec.has_resignation ? 'نعم ⚠' : 'لا ✓',
        'أول ظهور مشترك': fullDate(rec.first_both_month),
        'رقم الهاتف': str(result.phone_number),
        'وقت وتاريخ الإجراء': formatTimestamp(rec.search_timestamp),
      };
    });

    const sheet = XLSX.utils.json_to_sheet(generalRows);
    sheet['!views'] = [{ showGridLines: true }];
    sheet['!cols'] = [
      { wch: 5 }, { wch: 34 }, { wch: 14 }, { wch: 18 }, { wch: 16 },
      { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 20 }, { wch: 18 },
      { wch: 24 }, { wch: 30 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
      { wch: 18 }, { wch: 16 }, { wch: 22 }
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, isCheckedOnly ? 'الموظفون المحددون' : 'سجل العمليات الشامل');
  }

  // 6. Write and return Excel file
  const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(excelBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(defaultFilename)}"`,
      'Content-Length': excelBuffer.length.toString(),
    },
  });
}
