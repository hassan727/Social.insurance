import { NextResponse } from 'next/server';
import { supabaseService } from '@/lib/supabaseServer';

/**
 * POST /api/emergency-fix
 * Deletes ALL corrupted employee records from database
 * WARNING: This is destructive and cannot be easily undone
 */
export async function POST() {
  try {
    // Step 1: Get ALL employees and filter in-memory
    const { data: allEmployees, error: fetchError } = await supabaseService
      .from('employees_master')
      .select('id, employee_name, national_id, phone_number, current_job_title');

    if (fetchError || !allEmployees) {
      throw new Error('Failed to fetch employees: ' + (fetchError?.message ?? 'unknown'));
    }

    // Find corrupted IDs
    const corruptedIds: string[] = [];
    
    for (const emp of allEmployees) {
      let isCorrupted = false;

      // Pattern 1: name is pure number
      if (emp.employee_name && /^\d+$/.test(emp.employee_name.trim())) {
        isCorrupted = true;
      }

      // Pattern 2: national_id contains Arabic letters
      if (emp.national_id && /[ا-ي]/.test(emp.national_id)) {
        isCorrupted = true;
      }

      // Pattern 3: phone contains Arabic letters
      if (emp.phone_number && /[ا-ي]/.test(emp.phone_number)) {
        isCorrupted = true;
      }

      // Pattern 4: job_title is exactly 14 digits
      if (emp.current_job_title && /^\d{14}$/.test(emp.current_job_title.trim())) {
        isCorrupted = true;
      }

      if (isCorrupted) {
        corruptedIds.push(emp.id);
      }
    }

    console.log(`Found ${corruptedIds.length} corrupted records out of ${allEmployees.length} total`);

    // Delete in batches of 1000
    let deleted = 0;
    for (let i = 0; i < corruptedIds.length; i += 1000) {
      const batch = corruptedIds.slice(i, i + 1000);
      const { error: delError } = await supabaseService
        .from('employees_master')
        .delete()
        .in('id', batch);

      if (delError) {
        console.error('Batch deletion error:', delError);
      } else {
        deleted += batch.length;
      }
    }

    return NextResponse.json({
      success: true,
      total_records: allEmployees.length,
      corrupted_found: corruptedIds.length,
      deleted,
      remaining_records: allEmployees.length - deleted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('POST /api/emergency-fix error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
