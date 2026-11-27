import { NextResponse } from 'next/server';
import JSZip from 'jszip';
import { supabaseService } from '@/lib/supabaseServer';
import {
  tafqeet, quarterMonths, fillFront, addBackSection, patchRels, patchContentTypes,
  governorateFromAddress, accountDisplay,
  type LetterFields, type Quarter, type Sector,
} from '@/lib/hrLetterEngine';
import { HR_LETTER_TEMPLATE_B64 } from '@/lib/hrLetterTemplate';

// مفردات مرتب — read-only letter engine. No writes to any table.
// GET ?nid=14digits&quarter=Q1..Q4&sector=bank|consumer|installment|gov&entity=...&download=docx

const MONTH_NAMES: Record<number, string> = {
  1: 'يناير', 2: 'فبراير', 3: 'مارس', 4: 'أبريل', 5: 'مايو', 6: 'يونيو',
  7: 'يوليو', 8: 'أغسطس', 9: 'سبتمبر', 10: 'أكتوبر', 11: 'نوفمبر', 12: 'ديسمبر',
};

function parseAmount(val: unknown): number {
  if (val === null || val === undefined) return 0;
  const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? 0 : num;
}

function cairoToday(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  return `${get('day')} / ${get('month')} / ${get('year')}`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const nid = (searchParams.get('nid') || '').trim();
    const quarter = (searchParams.get('quarter') || 'Q3') as Quarter;
    const sector = (searchParams.get('sector') || 'bank') as Sector;
    const entity = (searchParams.get('entity') || '').trim();
    const download = searchParams.get('download') === 'docx';

    if (!/^\d{14}$/.test(nid)) {
      return NextResponse.json({ error: 'الرقم القومي لازم يكون ١٤ رقم' }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseService as any;

    const { data: masterRows } = await db
      .from('employees_master')
      .select('employee_code,employee_name,national_id,current_job_title,insurance_job_title,insurance_salary,insurance_start_date,hire_date,current_region,current_department,address,company_account')
      .eq('national_id', nid)
      .limit(1);
    const master = masterRows?.[0];

    const { data: payrollRows } = await db
      .from('monthly_payroll_records')
      .select('period_month,job_title,region,department,raw_data')
      .eq('national_id', nid)
      .order('period_month', { ascending: true });

    if (!master && (!payrollRows || payrollRows.length === 0)) {
      return NextResponse.json({ error: 'الموظف غير موجود في قاعدة البيانات' }, { status: 404 });
    }

    const { data: incomingRows } = await db
      .from('incoming_insurance_records')
      .select('insurance_job_title,subscription_start_date,raw_data')
      .eq('national_id', nid)
      .limit(5);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const incoming = (incomingRows || []).find((r: any) => r?.insurance_job_title) || incomingRows?.[0];

    // Monthly net = صافى التحويل only (Hassan's rule, 2026-11-27)
    const netByMonth: Record<number, number> = {};
    let payrollJob = '', region = master?.current_region || '', department = master?.current_department || '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of payrollRows || [] as any[]) {
      const month = Number(r.period_month);
      const raw = (r.raw_data || {}) as Record<string, unknown>;
      const net = parseAmount(raw['صافى التحويل']);
      if (net > 0 || !netByMonth[month]) netByMonth[month] = net;
      if (!payrollJob) payrollJob = String(r.job_title || raw['الوظيفة نهائي'] || '').trim();
      if (!region) region = String(r.region || raw['المنطقة نهائي'] || '').trim();
      if (!department) department = String(r.department || raw['الادارة نهائي'] || '').trim();
    }

    const months = quarterMonths(quarter);
    const monthDetails = months.map((m) => ({ month: m, name: MONTH_NAMES[m], net: netByMonth[m] || 0 }));
    const worked = monthDetails.filter((d) => d.net > 0);
    const average = worked.length ? Math.round(worked.reduce((a, d) => a + d.net, 0) / worked.length) : 0;

    const insJob = String(master?.insurance_job_title || incoming?.insurance_job_title || '').trim();
    const insWage = parseAmount(master?.insurance_salary) ||
      parseAmount((incoming?.raw_data as Record<string, unknown> | undefined)?.['insurance_salary']);
    const startIso = String(master?.hire_date || master?.insurance_start_date || incoming?.subscription_start_date || '').slice(0, 10);

    const isGov = sector === 'gov';
    const job = isGov ? (insJob || payrollJob || String(master?.current_job_title || '')) : (payrollJob || String(master?.current_job_title || ''));
    const amount = isGov ? insWage : average;

    if (isGov && !amount) {
      return NextResponse.json({ error: 'مفيش أجر تأميني مسجل للموظف ده' }, { status: 422 });
    }
    if (!isGov && !worked.length) {
      return NextResponse.json({ error: 'مفيش صافي تحويل في الربع ده للموظف ده' }, { status: 422 });
    }

    const fields: LetterFields = {
      entity,
      name: String(master?.employee_name || ''),
      nid,
      job,
      startIso,
      amount,
      printDate: cairoToday(),
      governorate: governorateFromAddress(String(master?.address || '')),
      region,
      department,
      accountName: accountDisplay(String(master?.company_account || '')),
    };

    const preview = {
      employee: {
        code: String(master?.employee_code || ''),
        name: fields.name,
        nid,
        job: payrollJob || String(master?.current_job_title || ''),
        insJob,
        insWage,
        hireDate: startIso,
        region, department,
        address: String(master?.address || ''),
        account: fields.accountName,
      },
      quarter, sector, entity,
      months: monthDetails,
      workedMonths: worked.length,
      average,
      words: tafqeet(amount),
      amount,
      startIso: fields.startIso,
    };

    if (!download) return NextResponse.json(preview);
    if (!entity) return NextResponse.json({ error: 'اختار الجهة الأول' }, { status: 400 });

    const zip = await JSZip.loadAsync(Buffer.from(HR_LETTER_TEMPLATE_B64, 'base64'));
    let xml = await zip.file('word/document.xml')!.async('string');
    xml = fillFront(xml, fields).xml;
    const back = addBackSection(xml, fields);
    zip.file('word/document.xml', back.xml);
    zip.file('word/header2.xml', back.extras['word/header2.xml']);
    zip.file('word/footer2.xml', back.extras['word/footer2.xml']);
    const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
    zip.file('word/_rels/document.xml.rels', patchRels(rels));
    const ct = await zip.file('[Content_Types].xml')!.async('string');
    zip.file('[Content_Types].xml', patchContentTypes(ct));

    const out = await zip.generateAsync({ type: 'uint8array' });
    const filename = `مفردات-مرتب-${preview.employee.code || nid}.docx`;
    return new NextResponse(Buffer.from(out), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="hr-letter.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (e) {
    console.error('hr-letter error', e);
    return NextResponse.json({ error: 'حصل خطأ غير متوقع' }, { status: 500 });
  }
}
