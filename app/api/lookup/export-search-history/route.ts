import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';
import * as XLSX from 'xlsx';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const uniqueOnly = searchParams.get('unique') !== 'false';
    const purposeFilter = searchParams.get('purpose') || '';

    // Fetch all search history ordered by most recent
    const { data: searchHistory, error } = await supabaseServer
      .from('search_history')
      .select('*')
      .eq('result_found', true)
      .order('search_timestamp', { ascending: false });

    if (error) {
      throw new Error(`فشل جلب سجل البحث: ${error.message}`);
    }

    if (!searchHistory || searchHistory.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'لا يوجد سجل بحث لتصديره',
      }, { status: 404 });
    }

    // Deduplicate by national_id (keep most recent) if requested
    let processedRecords = searchHistory;
    if (uniqueOnly) {
      const uniqueMap = new Map<string, typeof searchHistory[0]>();
      for (const record of searchHistory) {
        const key = record.national_id || record.employee_code || record.employee_name;
        if (key && !uniqueMap.has(key)) {
          uniqueMap.set(key, record);
        }
      }
      processedRecords = Array.from(uniqueMap.values());
    }

    // ── Export timestamp ──
    const now = new Date();
    const exportTimestamp = now.toLocaleString('ar-EG', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const dateStr = now.toISOString().split('T')[0];
    const hours = now.getHours().toString().padStart(2, '0');
    const mins = now.getMinutes().toString().padStart(2, '0');

    // Purpose label mapping
    const purposeLabels: Record<string, string> = {
      s1: 'س1 — تسجيل تأمين جديد',
      s6: 'س6 — إنهاء اشتراك',
      details: 'تفاصيل موظف',
      general: 'بحث عام',
    };

    // ── Helper: safe access into search_result JSONB ──
    type AnyRecord = Record<string, unknown>;
    const sr = (record: AnyRecord): AnyRecord => {
      const v = record.search_result;
      return (v && typeof v === 'object' && !Array.isArray(v)) ? (v as AnyRecord) : {};
    };
    const nested = (obj: AnyRecord, key: string): AnyRecord => {
      const v = obj[key];
      return (v && typeof v === 'object' && !Array.isArray(v)) ? (v as AnyRecord) : {};
    };
    const str = (v: unknown): string => (v != null && v !== '' ? String(v) : '—');

    // ── Build Excel rows ──
    const excelData = processedRecords.map((record, index) => {
      const result = sr(record as AnyRecord);
      const s1Info = nested(result, 's1_info');
      const s6Info = nested(result, 's6_info');
      const checklist = nested(result, 'checklist_action');

      // Insurance fields from JSONB
      const insuranceNumber = str(result.insurance_number);
      const insuranceJobTitle = str(result.insurance_job_title);
      const subscriptionStartDate = str(result.subscription_start_date);
      const phoneNumber = str(result.phone_number);
      const jobTitle = str(result.job_title);

      // Purpose stored at search time
      const recordPurpose = str(result._search_purpose);
      const purposeDisplay = purposeLabels[recordPurpose] || recordPurpose || 'بحث عام';

      // Checklist action fields
      const chosenStatus = str(checklist.insurance_status || record.insurance_status || 'تم التجهيز');
      const discrepancyNote = str(checklist.discrepancy_note);
      const archSupplyStatus = str(checklist.archives_supply_status);
      const archSupplyDate = str(checklist.archives_supply_date);
      let s6Action = '—';
      if (checklist.res_supplied_s6) s6Action = '✅ تم التوريد فعلياً';
      else if (checklist.res_ready_for_s6) s6Action = '📋 جاهز للتوريد (تم التجهيز)';
      else if (record.has_resignation) s6Action = '⚠ مسجل في شيت RES';

      // ── S1 Readiness ──
      const s1Status = str(s1Info.status);
      const s1CalcDate = str(s1Info.calculatedDate || s1Info.recordedDate);
      let s1Readiness = '—';
      if (s1Status === 'calculated')       s1Readiness = `✅ جاهز لتوريد س1 (${s1CalcDate})`;
      else if (s1Status === 'recorded')    s1Readiness = `✅ بيانات مسجلة بالدفاتر (${s1CalcDate})`;
      else if (s1Status === 'manual_review') s1Readiness = '⚠ يحتاج مراجعة يدوية';
      else if (s1Status === 'insufficient_data') s1Readiness = '⚠ بيانات ناقصة — راجع الحضور';

      // ── S6 Readiness ──
      const s6Status = str(s6Info.status);
      const s6CalcDate = str(s6Info.calculatedDate || s6Info.recordedDate);
      let s6Readiness = '—';
      if (s6Status === 'active')           s6Readiness = '🟢 مستمر بالخدمة (Active) — لا تنطبق س6';
      else if (s6Status === 'recorded')    s6Readiness = `✅ تاريخ نهاية مسجل (${s6CalcDate})`;
      else if (s6Status === 'calculated')  s6Readiness = `✅ جاهز لتوريد س6 (${s6CalcDate})`;
      else if (s6Status === 'insufficient_data') s6Readiness = '⚠ بيانات ناقصة';

      // ── Insurance eligibility summary ──
      let eligibility = 'غير محدد';
      let eligibilityNote = 'لا توجد معلومات كافية';
      const firstBoth = str(record.first_both_month);
      if (record.has_resignation) {
        eligibility = 'مستقيل — ينطبق س6';
        eligibilityNote = 'موظف مستقيل في شيت RES';
      } else if (firstBoth && firstBoth !== '—' && !firstBoth.includes('لم يظهر')) {
        if (firstBoth.includes('مرتبات فقط')) {
          eligibility = 'قابل للتأمين — غير مسجل بعد';
          eligibilityNote = 'موجود في المرتبات فقط';
        } else if (firstBoth.includes('تأمينات فقط')) {
          eligibility = 'مسجل في التأمينات فقط';
          eligibilityNote = 'لم يظهر في المرتبات';
        } else {
          eligibility = 'مسجل في المرتبات والتأمينات';
          eligibilityNote = `أول ظهور مشترك: ${firstBoth}`;
        }
      }

      // ── Format search timestamp ──
      const searchDate = new Date(record.search_timestamp);
      const formattedSearchDate = searchDate.toLocaleString('ar-EG', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });

      return {
        'م': index + 1,
        'الرقم القومي': str(record.national_id),
        'كود الموظف': str(record.employee_code),
        'اسم الموظف': str(record.employee_name),
        'الحالة التأمينية (الإجراء)': chosenStatus,
        'نوع / سبب المناقضة': discrepancyNote,
        'إجراء استمارة سن 6': s6Action,
        'جاهزية س1 — بداية الاشتراك': s1Readiness,
        'جاهزية س6 — نهاية الاشتراك': s6Readiness,
        'حالة توريد الأرشيف': archSupplyStatus,
        'تاريخ توريد الأرشيف': archSupplyDate,
        'الشركة (Account)': str(record.company_account),
        'الوظيفة الفعلية': jobTitle,
        'الرقم التأميني': insuranceNumber,
        'مهنة التأمينات': insuranceJobTitle,
        'تاريخ بداية الاشتراك': subscriptionStartDate,
        'رقم الهاتف': phoneNumber,
        'حالة التأمين الموحدة': eligibility,
        'تفاصيل التأمين': eligibilityNote,
        'أول ظهور مشترك (مرتبات + تأمينات)': firstBoth,
        'أيام الحضور': str(record.attendance_days),
        'الحالة الوظيفية': str(record.status),
        'مستقيل؟': record.has_resignation ? 'نعم ⚠' : 'لا ✓',
        'غرض البحث': purposeDisplay,
        'تاريخ ووقت البحث': formattedSearchDate,
      };
    });

    // ── Build Workbook ──
    const workbook = XLSX.utils.book_new();

    // ── 1. Main Sheet: سجل البحث والإجراءات الكامل ──
    const mainWorksheet = XLSX.utils.json_to_sheet(excelData);
    mainWorksheet['!views'] = [{ showGridLines: true }];
    mainWorksheet['!cols'] = [
      { wch: 5 },   // م
      { wch: 18 },  // الرقم القومي
      { wch: 12 },  // كود الموظف
      { wch: 32 },  // اسم الموظف
      { wch: 22 },  // الحالة التأمينية (الإجراء)
      { wch: 30 },  // نوع المناقضة
      { wch: 26 },  // إجراء سن 6
      { wch: 35 },  // جاهزية س1
      { wch: 35 },  // جاهزية س6
      { wch: 18 },  // حالة توريد الأرشيف
      { wch: 18 },  // تاريخ توريد الأرشيف
      { wch: 12 },  // الشركة
      { wch: 25 },  // الوظيفة
      { wch: 16 },  // الرقم التأميني
      { wch: 22 },  // مهنة التأمينات
      { wch: 20 },  // تاريخ بداية الاشتراك
      { wch: 16 },  // الهاتف
      { wch: 28 },  // حالة التأمين الموحدة
      { wch: 35 },  // تفاصيل التأمين
      { wch: 28 },  // أول ظهور مشترك
      { wch: 12 },  // أيام الحضور
      { wch: 18 },  // الحالة الوظيفية
      { wch: 10 },  // مستقيل
      { wch: 24 },  // غرض البحث
      { wch: 22 },  // تاريخ البحث
    ];
    XLSX.utils.book_append_sheet(workbook, mainWorksheet, 'سجل البحث والإجراءات');

    // ── 2. Discrepancies Sheet: شيت المناقضات ──
    const discrepanciesData = processedRecords
      .map((r, i) => {
        const result = sr(r as AnyRecord);
        const cl = nested(result, 'checklist_action');
        const st = str(cl.insurance_status || r.insurance_status);
        const note = str(cl.discrepancy_note);
        const isDisc = st.includes('مناقضة') || (note !== '—' && note.trim().length > 0);
        if (!isDisc) return null;
        return {
          'م': i + 1,
          'كود الموظف': str(r.employee_code),
          'اسم الموظف': str(r.employee_name),
          'الرقم القومي': str(r.national_id),
          'نوع / سبب المناقضة': note !== '—' ? note : 'نقص استيفاء أوراق / مراجعة',
          'الحالة': 'مناقضة',
          'الشركة': str(r.company_account),
          'الوظيفة': str(result.job_title),
          'تاريخ الإجراء': str(cl.action_timestamp || r.search_timestamp),
        };
      })
      .filter(Boolean);

    if (discrepanciesData.length > 0) {
      const discWorksheet = XLSX.utils.json_to_sheet(discrepanciesData);
      discWorksheet['!views'] = [{ showGridLines: true }];
      discWorksheet['!cols'] = [
        { wch: 5 }, { wch: 14 }, { wch: 32 }, { wch: 18 },
        { wch: 35 }, { wch: 14 }, { wch: 14 }, { wch: 25 }, { wch: 24 }
      ];
      XLSX.utils.book_append_sheet(workbook, discWorksheet, 'شيت المناقضات');
    }

    // ── 3. S6 Sheet: استمارات سن 6 ──
    const s6Data = processedRecords
      .map((r, i) => {
        const result = sr(r as AnyRecord);
        const cl = nested(result, 'checklist_action');
        const s6Info = nested(result, 's6_info');
        const isS6 = !!cl.res_ready_for_s6 || !!cl.res_supplied_s6 || r.has_resignation;
        if (!isS6) return null;
        return {
          'م': i + 1,
          'كود الموظف': str(r.employee_code),
          'اسم الموظف': str(r.employee_name),
          'الرقم القومي': str(r.national_id),
          'حالة استمارة س6': cl.res_supplied_s6 ? 'تم التوريد فعلياً' : cl.res_ready_for_s6 ? 'جاهز للتوريد (تم التجهيز)' : 'مسجل بالاستقالات',
          'تاريخ التوريد': str(cl.res_supply_date || s6Info.recordedDate),
          'نوع التوريد': str(cl.res_supply_type || 'يدوي'),
          'تاريخ نهاية الاشتراك': str(s6Info.calculatedDate || s6Info.recordedDate),
          'حالة الاستقالة': str(s6Info.resignationType || 'استقالة'),
          'تاريخ البحث': str(r.search_timestamp),
        };
      })
      .filter(Boolean);

    if (s6Data.length > 0) {
      const s6Worksheet = XLSX.utils.json_to_sheet(s6Data);
      s6Worksheet['!views'] = [{ showGridLines: true }];
      s6Worksheet['!cols'] = [
        { wch: 5 }, { wch: 14 }, { wch: 32 }, { wch: 18 },
        { wch: 25 }, { wch: 18 }, { wch: 16 }, { wch: 24 }, { wch: 20 }, { wch: 24 }
      ];
      XLSX.utils.book_append_sheet(workbook, s6Worksheet, 'استمارات سن 6');
    }

    // ── 4. Archives Sheet: الأرشيف والمستندات ──
    const archivesData = processedRecords
      .map((r, i) => {
        const result = sr(r as AnyRecord);
        const cl = nested(result, 'checklist_action');
        const docs = nested(cl, 'archives_docs') as Record<string, boolean>;
        const hasArch = cl.archives_supply_status || Object.keys(docs).length > 0;
        if (!hasArch) return null;
        return {
          'م': i + 1,
          'كود الموظف': str(r.employee_code),
          'اسم الموظف': str(r.employee_name),
          'الرقم القومي': str(r.national_id),
          'حالة التوريد': str(cl.archives_supply_status),
          'تاريخ التوريد': str(cl.archives_supply_date),
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
        };
      })
      .filter(Boolean);

    if (archivesData.length > 0) {
      const archWorksheet = XLSX.utils.json_to_sheet(archivesData);
      archWorksheet['!views'] = [{ showGridLines: true }];
      archWorksheet['!cols'] = [
        { wch: 5 }, { wch: 14 }, { wch: 32 }, { wch: 18 }, { wch: 16 }, { wch: 16 },
        { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }
      ];
      XLSX.utils.book_append_sheet(workbook, archWorksheet, 'الأرشيف والمستندات');
    }

    // ── Generate file ──
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const purposeSuffix = purposeFilter && purposeFilter !== 'general' ? `_${purposeFilter}` : '';
    const filename = `سجل_البحث${purposeSuffix}_${dateStr}_${hours}-${mins}.xlsx`;

    return new NextResponse(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': excelBuffer.length.toString(),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء تصدير سجل البحث';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
