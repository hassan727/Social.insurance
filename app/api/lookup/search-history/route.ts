import { NextRequest, NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabaseServer';

export interface EnrichedSearchHistoryRecord {
  id: string;
  search_query: string;
  national_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  result_found: boolean | null;
  search_timestamp: string;
  company_account: string | null;
  insurance_status: string | null;
  status: string | null;
  has_resignation: boolean | null;
  first_both_month: string | null;
  attendance_days: string | null;
  
  // Custom operation & purpose fields
  search_purpose: string;
  purpose_label: string;
  discrepancy_note: string;
  s1_readiness: string;
  s6_readiness: string;
  archives_status: string;
  archives_supply_date: string;
  insurance_number: string;
  job_title: string;
  insurance_job_title?: string;
  subscription_start_date?: string;
  phone_number: string;
  checklist_note: string;
  
  // Insurance eligibility
  insurance_eligibility: string;
  insurance_eligibility_note: string;
  raw_result?: unknown;
}

const PURPOSE_LABELS: Record<string, string> = {
  general: 'بحث عام 🔍',
  s1: 'س1 — تسجيل جديد 📋',
  s6: 'س6 — إنهاء اشتراك 🔴',
  details: 'تفاصيل كاملة 👤',
  discrepancy: 'مناقضة ⚠️',
  supplied: 'تم التوريد 📤',
  archives: 'الأرشيف 📁',
};

// ══════════════════════════════════════════════════════════════════
// GET: Fetch search history records with rich filters & stats
// ══════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 1000;
    const uniqueOnly = searchParams.get('unique') === 'true';
    const purposeFilter = (searchParams.get('purpose') || '').toLowerCase().trim();
    const dateFilter = (searchParams.get('date') || '').toLowerCase().trim();
    const searchQuery = (searchParams.get('search') || '').toLowerCase().trim();

    // Base query
    let query = supabaseService
      .from('search_history')
      .select('*')
      .eq('result_found', true)
      .order('search_timestamp', { ascending: false });

    // Date filtering in query if simple
    if (dateFilter === 'today') {
      const todayStr = new Date().toISOString().split('T')[0];
      query = query.gte('search_timestamp', `${todayStr}T00:00:00.000Z`);
    } else if (dateFilter === 'week') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      query = query.gte('search_timestamp', d.toISOString());
    }

    const { data: rawHistory, error } = await query.limit(limit);

    if (error) {
      throw new Error(`فشل جلب سجل البحث: ${error.message}`);
    }

    if (!rawHistory || rawHistory.length === 0) {
      return NextResponse.json({
        success: true,
        records: [],
        total: 0,
        stats: { total: 0, today: 0, s1_ready: 0, s6_ready: 0, discrepancies: 0, supplied: 0 },
        message: 'لا يوجد سجل بحث حتى الآن',
      });
    }

    // Helper functions
    type AnyRecord = Record<string, unknown>;
    const sr = (record: AnyRecord): AnyRecord => {
      const v = record.search_result;
      return (v && typeof v === 'object' && !Array.isArray(v)) ? (v as AnyRecord) : {};
    };
    const nested = (obj: AnyRecord, key: string): AnyRecord => {
      const v = obj[key];
      return (v && typeof v === 'object' && !Array.isArray(v)) ? (v as AnyRecord) : {};
    };
    const str = (v: unknown): string => (v != null && v !== '' ? String(v).trim() : '');

    // Deduplicate if requested
    let processedRecords = rawHistory;
    if (uniqueOnly) {
      const uniqueMap = new Map<string, typeof rawHistory[0]>();
      for (const record of rawHistory) {
        const key = record.national_id || record.employee_code || record.employee_name;
        if (key && !uniqueMap.has(key)) {
          uniqueMap.set(key, record);
        }
      }
      processedRecords = Array.from(uniqueMap.values());
    }

    // Today string
    const todayStr = new Date().toISOString().split('T')[0];

    // Compute system-wide stats before purpose filtering
    let todayCount = 0;
    let s1ReadyCount = 0;
    let s6ReadyCount = 0;
    let discrepancyCount = 0;
    let suppliedCount = 0;

    for (const r of processedRecords) {
      if (r.search_timestamp && r.search_timestamp.startsWith(todayStr)) {
        todayCount++;
      }
      const res = sr(r as AnyRecord);
      const cl = nested(res, 'checklist_action');
      const s1Info = nested(res, 's1_info');
      const s6Info = nested(res, 's6_info');
      const st = str(cl.insurance_status || r.insurance_status);

      if (s1Info.status === 'calculated' || s1Info.status === 'recorded' || st.includes('تجهيز')) {
        s1ReadyCount++;
      }
      if (r.has_resignation || cl.res_ready_for_s6 || cl.res_supplied_s6 || s6Info.status === 'calculated') {
        s6ReadyCount++;
      }
      if (st.includes('مناقضة') || (str(cl.discrepancy_note).length > 0)) {
        discrepancyCount++;
      }
      if (st.includes('توريد') || cl.res_supplied_s6 || cl.archives_supply_status === 'تم التوريد') {
        suppliedCount++;
      }
    }

    // Enrich records
    let enriched: EnrichedSearchHistoryRecord[] = processedRecords.map((record) => {
      const result = sr(record as AnyRecord);
      const cl = nested(result, 'checklist_action');
      const s1Info = nested(result, 's1_info');
      const s6Info = nested(result, 's6_info');

      const recordPurpose = str(result._search_purpose) || 'general';
      const insuranceStatus = str(cl.insurance_status || record.insurance_status || 'تم التجهيز');
      const discrepancyNote = str(cl.discrepancy_note);

      // S1 Readiness
      let s1Readiness = '—';
      if (s1Info.status === 'calculated') s1Readiness = `جاهز س1 (${str(s1Info.calculatedDate || s1Info.recordedDate)})`;
      else if (s1Info.status === 'recorded') s1Readiness = `مسجل (${str(s1Info.recordedDate)})`;
      else if (s1Info.status === 'manual_review') s1Readiness = 'يحتاج مراجعة';

      // S6 Readiness
      let s6Readiness = '—';
      if (cl.res_supplied_s6) s6Readiness = 'تم التوريد فعلياً';
      else if (cl.res_ready_for_s6) s6Readiness = 'جاهز للتوريد';
      else if (record.has_resignation) s6Readiness = 'مسجل بالاستقالات';
      else if (s6Info.status === 'active') s6Readiness = 'مستمر';

      // Insurance eligibility
      let eligibility = 'غير محدد';
      let eligibilityNote = '—';
      if (record.has_resignation) {
        eligibility = 'مستقيل';
        eligibilityNote = 'مسجل في الاستقالات';
      } else if (insuranceStatus.includes('مؤمن عليه')) {
        eligibility = 'مؤمن عليه';
        eligibilityNote = 'مسجل ببرنت التأمينات';
      } else if (insuranceStatus.includes('مناقضة')) {
        eligibility = 'مناقضة';
        eligibilityNote = discrepancyNote || 'يحتاج استيفاء';
      } else if (insuranceStatus.includes('توريد')) {
        eligibility = 'تم التوريد';
        eligibilityNote = 'تم توريد الاستمارة';
      }

      return {
        id: record.id,
        search_query: record.search_query,
        national_id: record.national_id,
        employee_code: record.employee_code,
        employee_name: record.employee_name,
        result_found: record.result_found,
        search_timestamp: record.search_timestamp,
        company_account: record.company_account,
        insurance_status: insuranceStatus,
        status: record.status,
        has_resignation: record.has_resignation,
        first_both_month: record.first_both_month,
        attendance_days: record.attendance_days,
        search_purpose: recordPurpose,
        purpose_label: PURPOSE_LABELS[recordPurpose] || recordPurpose,
        discrepancy_note: discrepancyNote,
        s1_readiness: s1Readiness,
        s6_readiness: s6Readiness,
        archives_status: str(cl.archives_supply_status),
        archives_supply_date: str(cl.archives_supply_date),
        insurance_number: str(result.insurance_number),
        job_title: str(result.job_title),
        insurance_job_title: str(result.insurance_job_title),
        subscription_start_date: str(result.subscription_start_date || record.first_both_month),
        phone_number: str(result.phone_number),
        checklist_note: str(cl.checklist_note),
        insurance_eligibility: eligibility,
        insurance_eligibility_note: eligibilityNote,
        raw_result: result,
      };
    });

    // Filter by purpose if specified
    if (purposeFilter && purposeFilter !== 'all') {
      if (purposeFilter === 's1') {
        enriched = enriched.filter((r) => r.search_purpose === 's1' || r.s1_readiness.includes('س1') || r.insurance_status?.includes('تجهيز'));
      } else if (purposeFilter === 's6') {
        enriched = enriched.filter((r) => r.search_purpose === 's6' || r.has_resignation || r.s6_readiness.includes('توريد') || r.s6_readiness.includes('استقالات'));
      } else if (purposeFilter === 'discrepancy' || purposeFilter === 'مناقضة') {
        enriched = enriched.filter((r) => r.insurance_status?.includes('مناقضة') || (r.discrepancy_note && r.discrepancy_note.length > 0));
      } else if (purposeFilter === 'supplied' || purposeFilter === 'تم التوريد') {
        enriched = enriched.filter((r) => r.insurance_status?.includes('توريد') || r.s6_readiness.includes('تم التوريد') || r.archives_status === 'تم التوريد');
      } else if (purposeFilter === 'archives') {
        enriched = enriched.filter((r) => !!r.archives_status || r.search_purpose === 'archives');
      } else if (purposeFilter === 'details') {
        enriched = enriched.filter((r) => r.search_purpose === 'details');
      } else if (purposeFilter === 'general') {
        enriched = enriched.filter((r) => r.search_purpose === 'general');
      }
    }

    // Filter by query string (name, code, national_id, phone, account)
    if (searchQuery) {
      enriched = enriched.filter((r) =>
        (r.employee_name && r.employee_name.toLowerCase().includes(searchQuery)) ||
        (r.employee_code && r.employee_code.toLowerCase().includes(searchQuery)) ||
        (r.national_id && r.national_id.includes(searchQuery)) ||
        (r.insurance_number && r.insurance_number.includes(searchQuery)) ||
        (r.phone_number && r.phone_number.includes(searchQuery)) ||
        (r.company_account && r.company_account.toLowerCase().includes(searchQuery))
      );
    }

    return NextResponse.json({
      success: true,
      records: enriched,
      total: enriched.length,
      stats: {
        total: processedRecords.length,
        today: todayCount,
        s1_ready: s1ReadyCount,
        s6_ready: s6ReadyCount,
        discrepancies: discrepancyCount,
        supplied: suppliedCount,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء جلب سجل البحث';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════════
// POST: Create a manual operation or search entry (CRUD: Create)
// ══════════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      national_id,
      employee_code,
      employee_name,
      insurance_status = 'تم التجهيز',
      discrepancy_note,
      search_purpose = 'general',
      company_account = 'EGYPT GAS',
      job_title,
      insurance_job_title,
      insurance_number,
      phone_number,
      checklist_note,
      status = 'Active',
      has_resignation = false,
      attendance_days,
      subscription_start_date,
      first_both_month,
      syncWithMaster = true,
    } = body;

    if (!national_id && !employee_code && !employee_name) {
      return NextResponse.json({ success: false, error: 'يجب توفير معرّف واحد على الأقل للموظف' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const cleanNatId = national_id?.trim() || null;
    const cleanCode = employee_code?.trim() || null;
    const cleanName = employee_name?.trim() || null;

    const searchResultData = {
      national_id: cleanNatId,
      employee_code: cleanCode,
      employee_name: cleanName,
      job_title: job_title || '',
      insurance_job_title: insurance_job_title || '',
      insurance_number: insurance_number || '',
      phone_number: phone_number || '',
      company_account: company_account || 'EGYPT GAS',
      attendance_days: attendance_days || null,
      first_both_month: first_both_month || null,
      subscription_start_date: subscription_start_date || first_both_month || null,
      status: status || 'Active',
      has_resignation: Boolean(has_resignation),
      _search_purpose: search_purpose,
      checklist_action: {
        insurance_status,
        discrepancy_note: discrepancy_note || '',
        checklist_note: checklist_note || '',
        action_timestamp: now,
      },
    };

    const newRecord = {
      search_query: cleanName || cleanNatId || cleanCode,
      national_id: cleanNatId,
      employee_code: cleanCode,
      employee_name: cleanName,
      company_account: company_account || null,
      insurance_status,
      status: status || null,
      has_resignation: Boolean(has_resignation),
      first_both_month: first_both_month || null,
      attendance_days: attendance_days || null,
      result_found: true,
      results_count: 1,
      search_timestamp: now,
      search_result: searchResultData as never,
    };

    const { data, error } = await supabaseService
      .from('search_history')
      .insert(newRecord)
      .select()
      .single();

    if (error) {
      throw new Error(`فشل إنشاء السجل: ${error.message}`);
    }

    // Sync with Master if requested
    if (syncWithMaster && (cleanNatId || cleanCode)) {
      await syncEmployeeWithDatabase({
        national_id: cleanNatId,
        employee_code: cleanCode,
        employee_name: cleanName,
        insurance_number: insurance_number || null,
        job_title: job_title || null,
        insurance_job_title: insurance_job_title || null,
        company_account: company_account || null,
        phone_number: phone_number || null,
        insurance_status: insurance_status || null,
        status: status || null,
        subscription_start_date: subscription_start_date || first_both_month || null,
        discrepancy_note: discrepancy_note || null,
        now,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'تم إضافة العملية ومزامنة السجلات بنجاح',
      record: data,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطأ أثناء إنشاء السجل';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════════
// PATCH: Update an existing record (CRUD: Update 1000000% Sync)
// ══════════════════════════════════════════════════════════════════
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      id,
      ids, // For bulk status update
      insurance_status,
      discrepancy_note,
      search_purpose,
      checklist_note,
      employee_name,
      employee_code,
      national_id,
      insurance_number,
      job_title,
      insurance_job_title,
      company_account,
      phone_number,
      attendance_days,
      first_both_month,
      subscription_start_date,
      status,
      has_resignation,
      syncWithMaster = true,
    } = body;

    // Handle Bulk Update if `ids` is provided
    if (Array.isArray(ids) && ids.length > 0) {
      if (!insurance_status) {
        return NextResponse.json({ success: false, error: 'يجب تحديد الحالة التأمينية للتحديث الجماعي' }, { status: 400 });
      }

      const { data: recordsToUpdate } = await supabaseService
        .from('search_history')
        .select('id, national_id, employee_code, employee_name, search_result')
        .in('id', ids);

      if (recordsToUpdate) {
        const now = new Date().toISOString();
        for (const rec of recordsToUpdate) {
          const currentSr = (rec.search_result && typeof rec.search_result === 'object')
            ? (rec.search_result as Record<string, unknown>)
            : {};
          const currentCl = (currentSr.checklist_action && typeof currentSr.checklist_action === 'object')
            ? (currentSr.checklist_action as Record<string, unknown>)
            : {};

          const updatedSr = {
            ...currentSr,
            checklist_action: {
              ...currentCl,
              insurance_status,
              ...(discrepancy_note !== undefined ? { discrepancy_note } : {}),
              action_timestamp: now,
            },
          };

          await supabaseService
            .from('search_history')
            .update({
              insurance_status,
              search_result: updatedSr as never,
            })
            .eq('id', rec.id);

          if (syncWithMaster && (rec.national_id || rec.employee_code)) {
            await syncEmployeeWithDatabase({
              national_id: rec.national_id,
              employee_code: rec.employee_code,
              insurance_status,
              discrepancy_note,
              now,
            });
          }
        }
      }

      return NextResponse.json({
        success: true,
        message: `تم تحديث الحالة التأمينية لـ (${ids.length}) سجل بنجاح إلى "${insurance_status}"`,
      });
    }

    // Handle Single Record Update
    let targetRecord: { id: string; national_id: string | null; employee_code: string | null; employee_name: string | null; search_result: unknown } | null = null;

    if (id) {
      const { data: ex, error: loadErr } = await supabaseService
        .from('search_history')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!loadErr && ex) targetRecord = ex;
    }

    // Fallback: search by national_id or employee_code if id wasn't provided or not found
    if (!targetRecord && (national_id || employee_code)) {
      const conds: string[] = [];
      if (national_id) conds.push(`national_id.eq.${national_id}`);
      if (employee_code) conds.push(`employee_code.eq.${employee_code}`);

      const { data: exFallback } = await supabaseService
        .from('search_history')
        .select('*')
        .or(conds.join(','))
        .order('search_timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (exFallback) targetRecord = exFallback;
    }

    const prevNid = targetRecord?.national_id || null;
    const prevCode = targetRecord?.employee_code || null;
    const prevName = targetRecord?.employee_name || null;

    const newNid = national_id !== undefined ? (national_id?.trim() || null) : prevNid;
    const newCode = employee_code !== undefined ? (employee_code?.trim() || null) : prevCode;
    const newName = employee_name !== undefined ? (employee_name?.trim() || null) : prevName;

    const currentSr = (targetRecord?.search_result && typeof targetRecord.search_result === 'object')
      ? (targetRecord.search_result as Record<string, unknown>)
      : {};
    const currentCl = (currentSr.checklist_action && typeof currentSr.checklist_action === 'object')
      ? (currentSr.checklist_action as Record<string, unknown>)
      : {};

    const now = new Date().toISOString();

    const updatedSr = {
      ...currentSr,
      ...(newName !== undefined ? { employee_name: newName } : {}),
      ...(newCode !== undefined ? { employee_code: newCode } : {}),
      ...(newNid !== undefined ? { national_id: newNid } : {}),
      ...(insurance_number !== undefined ? { insurance_number } : {}),
      ...(job_title !== undefined ? { job_title } : {}),
      ...(insurance_job_title !== undefined ? { insurance_job_title } : {}),
      ...(company_account !== undefined ? { company_account } : {}),
      ...(phone_number !== undefined ? { phone_number } : {}),
      ...(attendance_days !== undefined ? { attendance_days } : {}),
      ...(first_both_month !== undefined ? { first_both_month } : {}),
      ...(subscription_start_date !== undefined ? { subscription_start_date } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(has_resignation !== undefined ? { has_resignation: Boolean(has_resignation) } : {}),
      ...(search_purpose ? { _search_purpose: search_purpose } : {}),
      checklist_action: {
        ...currentCl,
        ...(insurance_status ? { insurance_status } : {}),
        ...(discrepancy_note !== undefined ? { discrepancy_note } : {}),
        ...(checklist_note !== undefined ? { checklist_note } : {}),
        action_timestamp: now,
      },
    };

    let updatedRecord = null;

    if (targetRecord) {
      const updateFields: Record<string, unknown> = {
        search_result: updatedSr,
      };
      if (insurance_status !== undefined) updateFields.insurance_status = insurance_status;
      if (newName !== undefined)          updateFields.employee_name = newName;
      if (newCode !== undefined)          updateFields.employee_code = newCode;
      if (newNid !== undefined)           updateFields.national_id = newNid;
      if (company_account !== undefined)  updateFields.company_account = company_account;
      if (status !== undefined)           updateFields.status = status;
      if (has_resignation !== undefined)  updateFields.has_resignation = Boolean(has_resignation);
      if (first_both_month !== undefined) updateFields.first_both_month = first_both_month;
      if (attendance_days !== undefined)  updateFields.attendance_days = attendance_days;

      const { data: uRec, error: updateErr } = await supabaseService
        .from('search_history')
        .update(updateFields as never)
        .eq('id', targetRecord.id)
        .select()
        .single();

      if (updateErr) {
        throw new Error(`فشل تحديث السجل: ${updateErr.message}`);
      }
      updatedRecord = uRec;
    } else {
      // If no history record existed at all, insert one
      const { data: iRec } = await supabaseService
        .from('search_history')
        .insert({
          search_query: newName || newNid || newCode,
          national_id: newNid,
          employee_code: newCode,
          employee_name: newName,
          company_account: company_account || null,
          insurance_status: insurance_status || 'تم التجهيز',
          status: status || 'Active',
          has_resignation: Boolean(has_resignation),
          first_both_month: first_both_month || null,
          attendance_days: attendance_days || null,
          result_found: true,
          results_count: 1,
          search_timestamp: now,
          search_result: updatedSr as never,
        })
        .select()
        .single();
      updatedRecord = iRec;
    }

    // Cascade update to other search_history entries for this employee if identifiers changed
    if ((newNid && prevNid && newNid !== prevNid) || (newCode && prevCode && newCode !== prevCode)) {
      const histConds: string[] = [];
      if (prevNid) histConds.push(`national_id.eq.${prevNid}`);
      if (prevCode) histConds.push(`employee_code.eq.${prevCode}`);
      if (histConds.length > 0) {
        await supabaseService
          .from('search_history')
          .update({
            ...(newNid ? { national_id: newNid } : {}),
            ...(newCode ? { employee_code: newCode } : {}),
            ...(newName ? { employee_name: newName } : {}),
          })
          .or(histConds.join(','));
      }
    }

    // Side effect: sync with master database and sheets if requested
    if (syncWithMaster && (newNid || newCode || prevNid || prevCode)) {
      await syncEmployeeWithDatabase({
        prev_national_id: prevNid,
        prev_employee_code: prevCode,
        national_id: newNid,
        employee_code: newCode,
        employee_name: newName,
        insurance_number: insurance_number !== undefined ? insurance_number : (currentSr.insurance_number as string),
        job_title: job_title !== undefined ? job_title : (currentSr.job_title as string),
        insurance_job_title: insurance_job_title !== undefined ? insurance_job_title : (currentSr.insurance_job_title as string),
        company_account: company_account !== undefined ? company_account : (currentSr.company_account as string),
        phone_number: phone_number !== undefined ? phone_number : (currentSr.phone_number as string),
        insurance_status: insurance_status || undefined,
        status: status || undefined,
        subscription_start_date: subscription_start_date !== undefined ? subscription_start_date : (currentSr.subscription_start_date as string),
        discrepancy_note: discrepancy_note !== undefined ? discrepancy_note : undefined,
        now,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'تم تحديث بيانات الموظف وسجل العملية وقاعدة البيانات بنجاح',
      record: updatedRecord,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطأ أثناء تحديث السجل';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════════
// HELPER: Sync Employee with Master Database & Dynamic Sheets
// ══════════════════════════════════════════════════════════════════
async function syncEmployeeWithDatabase(params: {
  prev_national_id?: string | null;
  prev_employee_code?: string | null;
  national_id?: string | null;
  employee_code?: string | null;
  employee_name?: string | null;
  insurance_number?: string | null;
  job_title?: string | null;
  insurance_job_title?: string | null;
  company_account?: string | null;
  phone_number?: string | null;
  insurance_status?: string | null;
  status?: string | null;
  subscription_start_date?: string | null;
  discrepancy_note?: string | null;
  now: string;
}) {
  const {
    prev_national_id,
    prev_employee_code,
    national_id,
    employee_code,
    employee_name,
    insurance_number,
    job_title,
    insurance_job_title,
    company_account,
    phone_number,
    insurance_status,
    status,
    subscription_start_date,
    discrepancy_note,
    now,
  } = params;

  const targetNid = national_id || prev_national_id;
  const targetCode = employee_code || prev_employee_code;

  if (!targetNid && !targetCode) return;

  // 1. employees_master
  const masterConds: string[] = [];
  if (prev_national_id) masterConds.push(`national_id.eq.${prev_national_id}`);
  if (prev_employee_code) masterConds.push(`employee_code.eq.${prev_employee_code}`);
  if (targetNid && !masterConds.includes(`national_id.eq.${targetNid}`)) masterConds.push(`national_id.eq.${targetNid}`);
  if (targetCode && !masterConds.includes(`employee_code.eq.${targetCode}`)) masterConds.push(`employee_code.eq.${targetCode}`);

  const { data: existingMaster } = await supabaseService
    .from('employees_master')
    .select('id, employee_name, employee_code, national_id, company_account')
    .or(masterConds.join(','))
    .limit(1)
    .maybeSingle();

  const masterUpdateData: Record<string, unknown> = {
    last_updated_at: now,
  };
  // name / national ID / code go through edit_master_core below (uniqueness + history).
  // The account moves only through the confirmed transfer, never from this screen.
  if (insurance_number !== undefined) masterUpdateData.insurance_number = insurance_number || null;
  if (job_title !== undefined) masterUpdateData.current_job_title = job_title || null;
  if (phone_number !== undefined) masterUpdateData.phone_number = phone_number || null;
  if (insurance_status !== undefined) masterUpdateData.insurance_status = insurance_status || null;
  if (status !== undefined) masterUpdateData.current_status = status || null;
  if (subscription_start_date !== undefined) masterUpdateData.insurance_start_date = subscription_start_date || null;

  if (existingMaster?.id) {
    // Every master/profile edit goes through edit_employee_profile: uniqueness checks + history old vs new.
    const { last_updated_at: _lu, ...profileFields } = masterUpdateData;
    void _lu;
    if (Object.keys(profileFields).length > 0 || employee_name || national_id || employee_code || insurance_job_title !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: core, error: coreErr } = await (supabaseService as any).rpc('edit_employee_profile', {
        p_employee_id: existingMaster.id,
        p_fields: {
          ...profileFields,
          ...(employee_name ? { employee_name } : {}),
          ...(national_id ? { national_id } : {}),
          ...(employee_code ? { employee_code } : {}),
          ...(insurance_job_title !== undefined ? { insurance_job_title: insurance_job_title || null } : {}),
        },
        p_by: 'شاشة البحث',
        p_reason: 'تعديل من شاشة البحث',
      });
      if (coreErr) throw new Error(`فشل تعديل الماستر: ${coreErr.message}`);
      const res = core as unknown as { success?: boolean; error?: string; holder_name?: string } | null;
      if (!res || res.success !== true) {
        throw new Error(`لم يتم تعديل الماستر (${res?.error ?? 'unknown'})${res?.holder_name ? ` — مسجل باسم ${res.holder_name}` : ''}`);
      }
    }
  } else {
    // Insert new employee master row
    await supabaseService
      .from('employees_master')
      .insert({
        id: crypto.randomUUID(),
        employee_name: employee_name || 'بدون اسم',
        employee_code: employee_code || null,
        national_id: national_id || null,
        company_account: company_account || 'EGYPT GAS',
        current_job_title: job_title || null,
        insurance_job_title: insurance_job_title || null,
        insurance_number: insurance_number || null,
        insurance_status: insurance_status || 'تم التجهيز',
        current_status: status || 'Active',
        insurance_start_date: subscription_start_date || null,
        phone_number: phone_number || null,
        last_updated_at: now,
      });
  }

  // 2. incoming_insurance_records
  const incConds: string[] = [];
  if (prev_national_id) incConds.push(`national_id.eq.${prev_national_id}`);
  if (prev_employee_code) incConds.push(`employee_code.eq.${prev_employee_code}`);
  if (targetNid && !incConds.includes(`national_id.eq.${targetNid}`)) incConds.push(`national_id.eq.${targetNid}`);
  if (targetCode && !incConds.includes(`employee_code.eq.${targetCode}`)) incConds.push(`employee_code.eq.${targetCode}`);

  if (incConds.length > 0) {
    const incUpdate: Record<string, unknown> = {};
    if (employee_name) incUpdate.employee_name = employee_name;
    if (employee_code) incUpdate.employee_code = employee_code;
    if (national_id) incUpdate.national_id = national_id;
    if (insurance_number !== undefined) incUpdate.insurance_number = insurance_number;
    if (job_title !== undefined) incUpdate.job_title = job_title;
    if (insurance_job_title !== undefined) incUpdate.insurance_job_title = insurance_job_title;
    if (company_account !== undefined) incUpdate.company_account = company_account;
    if (insurance_status !== undefined) incUpdate.insurance_status = insurance_status;
    if (phone_number !== undefined) incUpdate.phone_number = phone_number;
    if (subscription_start_date !== undefined) incUpdate.subscription_start_date = subscription_start_date;
    if (status !== undefined) incUpdate.status = status;

    if (Object.keys(incUpdate).length > 0) {
      await supabaseService
        .from('incoming_insurance_records')
        .update(incUpdate as never)
        .or(incConds.join(','));
    }
  }

  // 3. sheet_data updates (update identifiers if changed)
  const sheetLookupConds: string[] = [];
  if (prev_national_id) sheetLookupConds.push(`row_national_id.eq.${prev_national_id}`);
  if (prev_employee_code) sheetLookupConds.push(`row_code.eq.${prev_employee_code}`);
  if (targetNid) sheetLookupConds.push(`row_national_id.eq.${targetNid}`);
  if (targetCode) sheetLookupConds.push(`row_code.eq.${targetCode}`);

  if (sheetLookupConds.length > 0) {
    const { data: sheetsToUpdate } = await supabaseService
      .from('sheet_data')
      .select('id, row_data')
      .or(sheetLookupConds.join(','))
      .eq('is_latest', true)
      .limit(50);

    if (sheetsToUpdate && sheetsToUpdate.length > 0) {
      for (const row of sheetsToUpdate) {
        const curData = (row.row_data && typeof row.row_data === 'object') ? (row.row_data as Record<string, unknown>) : {};
        const updatedRowData = {
          ...curData,
          ...(employee_name ? { 'الاسم': employee_name, employee_name } : {}),
          ...(employee_code ? { 'الكود': employee_code, employee_code } : {}),
          ...(national_id ? { 'الرقم القومى': national_id, 'الرقم القومي': national_id, national_id } : {}),
          ...(insurance_number ? { 'الرقم التاميني': insurance_number, 'الرقم التأميني': insurance_number, insurance_number } : {}),
          ...(insurance_status ? { 'الحاله': insurance_status, 'الحاله التامينيه': insurance_status, insurance_status } : {}),
          ...(job_title ? { 'الوظيفه': job_title, job_title } : {}),
          _action_date: now,
        };

        await supabaseService
          .from('sheet_data')
          .update({
            row_national_id: targetNid || null,
            row_code: targetCode || null,
            row_name: employee_name || null,
            row_data: updatedRowData,
            updated_at: now,
          })
          .eq('id', row.id);
      }
    }
  }

  // 4. Special sheets: شيت المنقاضات / أرقام وارد التأمين
  if (insurance_status === 'مناقضة') {
    const { data: discSheet } = await supabaseService
      .from('dynamic_sheets')
      .select('id')
      .or('sheet_name.eq.شيت المنقاضات,sheet_name.eq.المنقاضات')
      .limit(1)
      .maybeSingle();

    if (discSheet) {
      const { data: exDisc } = await supabaseService
        .from('sheet_data')
        .select('id')
        .eq('sheet_id', discSheet.id)
        .or(`row_national_id.eq.${targetNid || ''},row_code.eq.${targetCode || ''}`)
        .limit(1)
        .maybeSingle();

      const discRow = {
        الكود: targetCode || '',
        الاسم: employee_name || '',
        'الرقم القومى': targetNid || '',
        'نوع المناقضة': discrepancy_note || '',
        'الحاله': 'مناقضة',
        _action_date: now,
      };

      if (exDisc) {
        await supabaseService.from('sheet_data').update({ row_data: discRow, updated_at: now }).eq('id', exDisc.id);
      } else {
        await supabaseService.from('sheet_data').insert({
          sheet_id: discSheet.id,
          row_national_id: targetNid || null,
          row_code: targetCode || null,
          row_name: employee_name || null,
          row_data: discRow,
          is_latest: true,
          created_at: now,
        });
      }
    }
  }

  if (insurance_status === 'تم التوريد') {
    const { data: incSheet } = await supabaseService
      .from('dynamic_sheets')
      .select('id')
      .ilike('sheet_name', '%وارد%')
      .limit(1)
      .maybeSingle();

    if (incSheet) {
      const { data: exInc } = await supabaseService
        .from('sheet_data')
        .select('id')
        .eq('sheet_id', incSheet.id)
        .or(`row_national_id.eq.${targetNid || ''},row_code.eq.${targetCode || ''}`)
        .limit(1)
        .maybeSingle();

      const incRow = {
        الكود: targetCode || '',
        الاسم: employee_name || '',
        'الرقم القومى': targetNid || '',
        'الحاله': 'تم التوريد',
        'تاريخ التوريد': now.split('T')[0],
        _action_date: now,
      };

      if (exInc) {
        await supabaseService.from('sheet_data').update({ row_data: incRow, updated_at: now }).eq('id', exInc.id);
      } else {
        await supabaseService.from('sheet_data').insert({
          sheet_id: incSheet.id,
          row_national_id: targetNid || null,
          row_code: targetCode || null,
          row_name: employee_name || null,
          row_data: incRow,
          is_latest: true,
          created_at: now,
        });
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// DELETE: Delete single or bulk records or clear all (CRUD: Delete)
// ══════════════════════════════════════════════════════════════════
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const queryId = searchParams.get('id');
    const body = await request.json().catch(() => ({}));

    const id = body.id || queryId;
    const ids: string[] = body.ids || [];
    const action = body.action || searchParams.get('action');

    // 1. Clear all or clear today
    if (action === 'clear_all') {
      const { error } = await supabaseService
        .from('search_history')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

      if (error) throw new Error(`فشل مسح السجل: ${error.message}`);
      return NextResponse.json({ success: true, message: 'تم مسح كامل سجل البحث بنجاح' });
    }

    if (action === 'clear_today') {
      const todayStr = new Date().toISOString().split('T')[0];
      const { error } = await supabaseService
        .from('search_history')
        .delete()
        .gte('search_timestamp', `${todayStr}T00:00:00.000Z`);

      if (error) throw new Error(`فشل مسح سجلات اليوم: ${error.message}`);
      return NextResponse.json({ success: true, message: 'تم مسح سجلات اليوم بنجاح' });
    }

    // 2. Bulk delete (Delete all selected employees and all their duplicate historical search logs)
    if (ids.length > 0) {
      // First fetch employee identifiers for all selected rows
      const { data: matchedRecords } = await supabaseService
        .from('search_history')
        .select('id, national_id, employee_code, employee_name')
        .in('id', ids);

      // Delete by exact IDs
      const { error: delErr } = await supabaseService
        .from('search_history')
        .delete()
        .in('id', ids);

      if (delErr) throw new Error(`فشل حذف السجلات المحددة: ${delErr.message}`);

      // Crucial: also delete ALL duplicate historical search logs for these same employees!
      if (matchedRecords && matchedRecords.length > 0) {
        const nids = Array.from(new Set(matchedRecords.map((r) => r.national_id).filter(Boolean))) as string[];
        const codes = Array.from(new Set(matchedRecords.map((r) => r.employee_code).filter(Boolean))) as string[];
        const names = Array.from(new Set(matchedRecords.map((r) => r.employee_name).filter(Boolean))) as string[];

        if (nids.length > 0) {
          await supabaseService.from('search_history').delete().in('national_id', nids);
        }
        if (codes.length > 0) {
          await supabaseService.from('search_history').delete().in('employee_code', codes);
        }
        if (names.length > 0 && nids.length === 0 && codes.length === 0) {
          await supabaseService.from('search_history').delete().in('employee_name', names);
        }
      }

      return NextResponse.json({
        success: true,
        message: `تم حذف (${ids.length}) موظف وكافة سجلاتهم بالكامل بنجاح وتطهير السجل`,
      });
    }

    // 3. Single delete
    if (id) {
      const { data: singleRec } = await supabaseService
        .from('search_history')
        .select('id, national_id, employee_code, employee_name')
        .eq('id', id)
        .maybeSingle();

      const { error } = await supabaseService
        .from('search_history')
        .delete()
        .eq('id', id);

      if (error) throw new Error(`فشل حذف السجل: ${error.message}`);

      if (singleRec) {
        if (singleRec.national_id) {
          await supabaseService.from('search_history').delete().eq('national_id', singleRec.national_id);
        }
        if (singleRec.employee_code) {
          await supabaseService.from('search_history').delete().eq('employee_code', singleRec.employee_code);
        }
        if (!singleRec.national_id && !singleRec.employee_code && singleRec.employee_name) {
          await supabaseService.from('search_history').delete().eq('employee_name', singleRec.employee_name);
        }
      }

      return NextResponse.json({
        success: true,
        message: 'تم حذف سجل الموظف وكافة عملياته بالكامل بنجاح',
      });
    }

    return NextResponse.json({
      success: false,
      error: 'يجب تحديد معرّف السجل (id) أو مصفوفة المعرفات (ids) للحذف',
    }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطأ أثناء حذف السجل';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
