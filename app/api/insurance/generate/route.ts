import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

/**
 * POST /api/insurance/generate
 * Body: { period_year: number, period_month: number, default_wage?: number }
 *
 * Generates monthly_insurance_records for a given month directly from the
 * monthly_payroll_records of that month, pulling historical insurance numbers
 * and wages from previous months and incoming_insurance_records.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const period_year = Number(body.period_year) || 2026;
    const period_month = Number(body.period_month);
    const default_wage = Number(body.default_wage) || 5385;

    if (!period_month || period_month < 1 || period_month > 12) {
      return NextResponse.json({ error: 'يجب تحديد شهر صالح (1 - 12)' }, { status: 400 });
    }

    // 1. Fetch all valid payroll records for this month
    // Paginate to fetch all rows beyond Supabase 1000 limit
    const pageSize = 1000;
    let page = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payrollRows: any[] = [];

    while (true) {
      const { data, error: payErr } = await supabaseServer
        .from('monthly_payroll_records')
        .select('*')
        .eq('period_year', period_year)
        .eq('period_month', period_month)
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (payErr) throw payErr;
      if (!data || data.length === 0) break;

      // Filter out ghost rows (must have either code or name)
      for (const row of data) {
        if (row.employee_code || row.employee_name) {
          payrollRows.push(row);
        }
      }

      if (data.length < pageSize) break;
      page++;
    }

    if (payrollRows.length === 0) {
      return NextResponse.json(
        { error: `لا توجد سجلات مرتبات مسجلة لشهر ${period_month}/${period_year} لتوليد التأمينات منها.` },
        { status: 404 }
      );
    }

    // 2. Build Master Insurance Registry from incoming & previous insurance months
    // A) From incoming_insurance_records
    const { data: incomingData } = await supabaseServer
      .from('incoming_insurance_records')
      .select('employee_code, national_id, insurance_number, insurance_job_title, job_title');

    const incomingMap = new Map<string, { insNum?: string; insJob?: string }>();
    incomingData?.forEach((inc) => {
      const item = {
        insNum: inc.insurance_number || undefined,
        insJob: inc.insurance_job_title || inc.job_title || undefined,
      };
      if (inc.national_id) incomingMap.set(inc.national_id.trim(), item);
      if (inc.employee_code) incomingMap.set(inc.employee_code.trim(), item);
    });

    // B) From all previous monthly_insurance_records (most recent months first)
    const historyWageMap = new Map<string, { wage: number; insNum?: string }>();
    
    // We fetch previous months starting with month 9 downwards
    for (let m = period_month - 1; m >= 1; m--) {
      let histPage = 0;
      while (true) {
        const { data: pageRecs, error: hErr } = await supabaseServer
          .from('monthly_insurance_records')
          .select('employee_code, national_id, insurance_number, raw_data')
          .eq('period_year', period_year)
          .eq('period_month', m)
          .range(histPage * 1000, (histPage + 1) * 1000 - 1);

        if (hErr || !pageRecs || pageRecs.length === 0) break;

        for (const rec of pageRecs) {
          const nid = rec.national_id?.trim();
          const code = rec.employee_code?.trim();
          const raw = (rec.raw_data as Record<string, string>) || {};
          const wageVal = parseFloat(raw['الاجر التاميني'] || raw['الاجر التامينى'] || '0');
          const insNumVal = raw['الرقم التأميني'] || rec.insurance_number || undefined;

          if (nid && !historyWageMap.has(nid) && wageVal > 0) {
            historyWageMap.set(nid, { wage: wageVal, insNum: insNumVal });
          }
          if (code && !historyWageMap.has(code) && wageVal > 0) {
            historyWageMap.set(code, { wage: wageVal, insNum: insNumVal });
          }
        }

        if (pageRecs.length < 1000) break;
        histPage++;
      }
    }

    // 3. Clean up any existing records for this month (clean overwrite)
    await supabaseServer
      .from('monthly_insurance_records')
      .delete()
      .eq('period_year', period_year)
      .eq('period_month', period_month);

    await supabaseServer
      .from('import_logs')
      .delete()
      .eq('source_type', 'monthly_insurance')
      .eq('period_year', period_year)
      .eq('period_month', period_month);

    // 4. Create import_log entry
    const monthNames: Record<number, string> = {
      1: 'يناير', 2: 'فبراير', 3: 'مارس', 4: 'أبريل', 5: 'مايو', 6: 'يونيو',
      7: 'يوليو', 8: 'أغسطس', 9: 'سبتمبر', 10: 'أكتوبر', 11: 'نوفمبر', 12: 'ديسمبر',
    };
    const monthName = monthNames[period_month] || `شهر ${period_month}`;
    const generatedFileName = `التأمينات الاجتماعية ${monthName} ${period_year} (توليد آلي من المرتبات).xlsx`;

    const { data: logEntry, error: logErr } = await supabaseServer
      .from('import_logs')
      .insert({
        source_type: 'monthly_insurance',
        file_name: generatedFileName,
        sheet_name: 'Sheet1',
        period_year,
        period_month,
        total_rows_read: payrollRows.length,
        rows_accepted: payrollRows.length,
        rows_rejected: 0,
        notes: `تم توليد شيت التأمينات آلياً من كشف مرتبات ${monthName} ${period_year} لعدد ${payrollRows.length} موظف وفقاً لبيانات التأمينات المعتمدة.`,
      })
      .select('id')
      .single();

    if (logErr) throw logErr;
    const importId = logEntry.id;

    // 5. Generate and Insert insurance records
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recordsToInsert: any[] = [];
    let matchedHistoryCount = 0;
    let defaultWageCount = 0;
    let totalInsuranceWages = 0;
    let totalWorkerContrib = 0;
    let totalEmployerContrib = 0;

    for (const p of payrollRows) {
      const nid = (p.national_id || '').trim();
      const code = (p.employee_code || '').trim();
      const name = p.employee_name || '';
      const job = p.job_title || '';
      const dept = p.department || '';
      const region = p.region || '';

      const hist = (nid ? historyWageMap.get(nid) : null) || (code ? historyWageMap.get(code) : null);
      const inc = (nid ? incomingMap.get(nid) : null) || (code ? incomingMap.get(code) : null);

      let insWage = default_wage;
      if (hist && hist.wage > 0) {
        insWage = hist.wage;
        matchedHistoryCount++;
      } else {
        defaultWageCount++;
      }

      const insNum = hist?.insNum || inc?.insNum || '0';

      const worker11 = Math.round(insWage * 0.11 * 100) / 100;
      const employer1875 = Math.round(insWage * 0.1875 * 10000) / 10000;
      const total2975 = Math.round((worker11 + employer1875) * 10000) / 10000;

      totalInsuranceWages += insWage;
      totalWorkerContrib += worker11;
      totalEmployerContrib += employer1875;

      const rawData = {
        'الكود': code,
        'الاسم': name,
        'الرقم القومي': nid,
        'الوظيفة': job,
        'المنطقة': region,
        'الإدارة': dept,
        'الرقم التأميني': insNum,
        'الأجر التأميني': insWage.toFixed(2),
        'حصة صاحب العمل': employer1875.toFixed(2),
        'حصة العامل': worker11.toFixed(2),
        'الاجمالي': total2975.toFixed(2),
        // Standard aliases for lookup compatibility
        'القومي': nid,
        'الوظيفة نهائي': job,
        'المنطقة نهائي': region,
        'الادارة نهائي': dept,
        'الاجر التاميني': insWage.toFixed(2),
      };

      recordsToInsert.push({
        import_id: importId,
        period_year,
        period_month,
        employee_code: code || null,
        employee_name: name || null,
        national_id: nid || null,
        insurance_number: insNum !== '0' ? insNum : null,
        job_title: job || null,
        region: region || null,
        department: dept || null,
        raw_data: rawData,
      });
    }

    // Insert in batches of 500
    const batchSize = 500;
    for (let i = 0; i < recordsToInsert.length; i += batchSize) {
      const batch = recordsToInsert.slice(i, i + batchSize);
      const { error: insBatchErr } = await supabaseServer
        .from('monthly_insurance_records')
        .insert(batch);
      if (insBatchErr) throw insBatchErr;
    }

    return NextResponse.json({
      success: true,
      message: `✅ تم توليد وحفظ شيت تأمينات شهر ${monthName} ${period_year} بنجاح لـ ${recordsToInsert.length} موظف.`,
      summary: {
        totalEmployees: recordsToInsert.length,
        matchedHistoryCount,
        defaultWageCount,
        totalInsuranceWages: Math.round(totalInsuranceWages),
        totalWorkerContribution: Math.round(totalWorkerContrib),
        totalEmployerContribution: Math.round(totalEmployerContrib),
        totalInvoice: Math.round(totalWorkerContrib + totalEmployerContrib),
      },
    });
  } catch (err: unknown) {
    console.error('POST /api/insurance/generate error:', err);
    const msg = err instanceof Error ? err.message : 'حدث خطأ أثناء توليد شيت التأمينات';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
