import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

export interface SearchHistoryRecord {
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
  
  // Computed insurance eligibility
  insurance_eligibility: string;
  insurance_eligibility_note: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 1000;
    const uniqueOnly = searchParams.get('unique') === 'true'; // Get unique employees only

    // Fetch all search history ordered by most recent
    const { data: searchHistory, error } = await supabaseServer
      .from('search_history')
      .select('*')
      .eq('result_found', true) // Only searches that found results
      .order('search_timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`فشل جلب سجل البحث: ${error.message}`);
    }

    if (!searchHistory || searchHistory.length === 0) {
      return NextResponse.json({ 
        success: true, 
        records: [], 
        total: 0,
        message: 'لا يوجد سجل بحث حتى الآن' 
      });
    }

    // If unique only, deduplicate by national_id (keep most recent search for each employee)
    let processedRecords = searchHistory;
    
    if (uniqueOnly) {
      const uniqueMap = new Map<string, typeof searchHistory[0]>();
      
      for (const record of searchHistory) {
        // Use national_id as primary key, fallback to employee_code
        const key = record.national_id || record.employee_code || record.employee_name;
        
        if (key && !uniqueMap.has(key)) {
          uniqueMap.set(key, record);
        }
      }
      
      processedRecords = Array.from(uniqueMap.values());
    }

    // Enrich each record with insurance eligibility assessment
    const enrichedRecords: SearchHistoryRecord[] = processedRecords.map((record) => {
      let eligibility = 'غير محدد';
      let eligibilityNote = 'لا توجد معلومات كافية';

      // Determine insurance eligibility based on available data
      if (record.has_resignation) {
        eligibility = 'غير قابل للتأمين';
        eligibilityNote = 'موظف مستقيل';
      } else if (record.first_both_month && record.first_both_month !== 'لم يظهر في الملفات الشهرية بعد') {
        if (record.first_both_month.includes('مرتبات فقط')) {
          eligibility = 'قابل للتأمين - لكن غير مسجل';
          eligibilityNote = 'موجود في المرتبات لكن لم يظهر في التأمينات';
        } else if (record.first_both_month.includes('تأمينات فقط')) {
          eligibility = 'مسجل في التأمينات';
          eligibilityNote = 'موجود في التأمينات فقط (لم يظهر في المرتبات)';
        } else {
          // Has both payroll and insurance
          eligibility = 'قابل للتأمين - ومسجل';
          eligibilityNote = `ظهر في المرتبات والتأمينات معاً في ${record.first_both_month}`;
        }
      } else if (record.insurance_status) {
        if (record.insurance_status.includes('مؤمن')) {
          eligibility = 'قابل للتأمين - ومسجل';
          eligibilityNote = `حالة التأمين: ${record.insurance_status}`;
        } else if (record.insurance_status.includes('غير مؤمن') || record.insurance_status.includes('ملغي')) {
          eligibility = 'غير قابل للتأمين';
          eligibilityNote = `حالة التأمين: ${record.insurance_status}`;
        } else {
          eligibility = 'غير محدد';
          eligibilityNote = `حالة التأمين: ${record.insurance_status}`;
        }
      } else if (record.status) {
        eligibility = 'غير محدد';
        eligibilityNote = `الحالة: ${record.status}`;
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
        insurance_status: record.insurance_status,
        status: record.status,
        has_resignation: record.has_resignation,
        first_both_month: record.first_both_month,
        attendance_days: record.attendance_days,
        insurance_eligibility: eligibility,
        insurance_eligibility_note: eligibilityNote,
      };
    });

    return NextResponse.json({ 
      success: true, 
      records: enrichedRecords,
      total: enrichedRecords.length,
      uniqueOnly,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'حدث خطأ أثناء جلب سجل البحث';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
