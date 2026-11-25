import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabaseServer';

// ══════════════════════════════════════════════════════════════════
// GET /api/checklist?national_id=&employee_code=
// Returns the saved checklist for an employee (from search_history JSONB
// or employees_master)
// ══════════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const national_id   = searchParams.get('national_id') ?? '';
    const employee_code = searchParams.get('employee_code') ?? '';

    if (!national_id && !employee_code) {
      return NextResponse.json({ success: false, error: 'يجب تقديم الرقم القومي أو كود الموظف' }, { status: 400 });
    }

    const orConds: string[] = [];
    if (national_id)   orConds.push(`national_id.eq.${national_id}`);
    if (employee_code) orConds.push(`employee_code.eq.${employee_code}`);

    // Load from employees_master (insurance_status + meta)
    const { data: master } = await supabaseServer
      .from('employees_master')
      .select('id, insurance_status, current_status, insurance_number')
      .or(orConds.join(','))
      .limit(1)
      .maybeSingle();

    // Load saved checklist from checklist_records table (best-effort)
    const checklistOrConds: string[] = [];
    if (national_id)   checklistOrConds.push(`national_id.eq.${national_id}`);
    if (employee_code) checklistOrConds.push(`employee_code.eq.${employee_code}`);

    const { data: clRow } = await (supabaseServer as unknown as { from: (table: string) => any })
      .from('checklist_records')
      .select('*')
      .or(checklistOrConds.join(','))
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      checklist: clRow ?? null,
      master: master ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطأ في جلب بيانات القائمة';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════════
// POST /api/checklist
// Saves/updates checklist for an employee and triggers side-effects:
//  - Update employees_master.insurance_status
//  - If مناقضة → ensure row in sheet_data for شيت المنقاضات
//  - If تم التوريد → ensure row in sheet_data for ارقام وارد التامين
// ══════════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      national_id,
      employee_code,
      employee_name,
      // Social Insurance
      insurance_status,         // تم التجهيز | جاري التأمين | مؤمن عليه | مناقضة | تم التوريد
      discrepancy_note,         // نوع المناقضة (لو اختار مناقضة)
      // Archives
      archives_docs,            // Record<string, boolean> (العقد، صورة البطاقة، المؤهل، إلخ)
      archives_supply_status,   // حالة التوريد
      archives_supply_date,     // تاريخ التوريد
      // RES
      res_ready_for_s6,         // boolean (جاهز لتوريد سن 6)
      res_supplied_s6,          // boolean (تم توريد سن 6 فعلياً)
      res_supply_date,          // تاريخ توريد سن 6
      res_supply_type,          // نوع التوريد
      res_notes,                // ملاحظات
      // New employee sheet
      add_to_new_sheet,         // boolean
      new_employee_data,        // { name, national_id, insurance_number, phone, job, signing_date, address, code }
      // Requests
      request_type,
      request_status,
      request_date,
      request_receiver,
      request_note,
      // Extra free-form note
      checklist_note,
    } = body;

    if (!national_id && !employee_code) {
      return NextResponse.json({ success: false, error: 'يجب تقديم الرقم القومي أو كود الموظف' }, { status: 400 });
    }

    const orConds: string[] = [];
    if (national_id)   orConds.push(`national_id.eq.${national_id}`);
    if (employee_code) orConds.push(`employee_code.eq.${employee_code}`);

    const now = new Date().toISOString();
    const sideEffects: string[] = [];

    // Resolve the employee's account ONCE (distinct accounts of matching
    // masters; exactly one -> account-scoped sheet writes, otherwise
    // unresolved -> legacy shared fallback only). A checklist write must
    // never land in a sheet grounded to a DIFFERENT account.
    let employeeAccountId: number | null = null;
    {
      const { data: mastersForAccount } = await supabaseServer
        .from('employees_master')
        .select('account_id')
        .or(orConds.join(','));
      const distinctAccounts = [...new Set(
        (mastersForAccount || [])
          .map((m) => (m as { account_id: number | null }).account_id)
          .filter((a): a is number => a !== null && a !== undefined),
      )];
      if (distinctAccounts.length === 1) employeeAccountId = distinctAccounts[0];
    }

    // Sheet resolution for checklist side-effect writes:
    //  1. the sheet grounded to the employee's own account (exactly one);
    //  2. otherwise a single legacy shared (account_id NULL) sheet;
    //  3. otherwise fail closed (no write) with an explicit warning — never
    //     pick a sheet grounded to another account, never guess on ambiguity.
    type SheetRef = { id: string; sheet_name?: string; account_id: number | null };
    const resolveSheetForEmployee = async (
      nameFilter: { or?: string; ilike?: string },
    ): Promise<{ sheet: SheetRef | null; warning: string | null }> => {
      let q: any = supabaseServer.from('dynamic_sheets').select('id, sheet_name, account_id');
      if (nameFilter.or) q = q.or(nameFilter.or);
      if (nameFilter.ilike) q = q.ilike('sheet_name', nameFilter.ilike);
      const { data: matches } = await q;
      const all = (matches || []) as SheetRef[];
      const mine = employeeAccountId !== null ? all.filter((s) => s.account_id === employeeAccountId) : [];
      const legacy = all.filter((s) => s.account_id === null || s.account_id === undefined);
      if (mine.length === 1) return { sheet: mine[0], warning: null };
      if (mine.length > 1) return { sheet: null, warning: 'تعذر تحديد نسخة الورقة الخاصة بحساب الموظف (تعدد) — لم تتم الكتابة' };
      if (legacy.length === 1) return { sheet: legacy[0], warning: null };
      if (legacy.length > 1) return { sheet: null, warning: 'تعذر تحديد الورقة المشتركة (تعدد) — لم تتم الكتابة' };
      if (all.length > 0) return { sheet: null, warning: 'الورقة موجودة لحساب آخر فقط — لم تتم الكتابة لتجنب الخلط بين الحسابات' };
      return { sheet: null, warning: null };
    };

    // ── 1. Update employees_master.insurance_status ──────────────────────
    if (insurance_status) {
      const { error: updateErr } = await supabaseServer
        .from('employees_master')
        .update({
          insurance_status,
          last_updated_at: now,
        })
        .or(orConds.join(','));

      if (updateErr) {
        console.warn('Could not update employees_master insurance_status:', updateErr.message);
      } else {
        sideEffects.push(`تم تحديث الحالة التأمينية إلى "${insurance_status}" في سجل الموظف`);
      }
    }

    // ── 2. مناقضة → insert/update sheet_data for شيت المنقاضات ─────────
    if (insurance_status === 'مناقضة') {
      // Find the dynamic_sheets row for شيت المنقاضات (account-scoped)
      const { sheet: discSheet, warning: discWarn } = await resolveSheetForEmployee({
        or: 'sheet_name.eq.شيت المنقاضات,sheet_name.eq.المنقاضات',
      });

      if (discSheet) {
        // Check if already exists
        const { data: existingDisc } = await supabaseServer
          .from('sheet_data')
          .select('id')
          .eq('sheet_id', discSheet.id)
          .or(`row_national_id.eq.${national_id || ''},row_code.eq.${employee_code || ''}`)
          .eq('is_latest', true)
          .limit(1)
          .maybeSingle();

        const discRowData = {
          الكود:             employee_code ?? '',
          الاسم:             employee_name ?? '',
          'الرقم القومى':    national_id ?? '',
          'نوع المناقضة':    discrepancy_note ?? '',
          'الحاله':          'مناقضة',
          NOTE:              discrepancy_note ?? '',
          _checklist_action: 'مناقضة',
          _action_date:      now,
        };

        if (existingDisc) {
          await supabaseServer
            .from('sheet_data')
            .update({ row_data: discRowData, updated_at: now })
            .eq('id', existingDisc.id);
          sideEffects.push('تم تحديث سجل الموظف في شيت المناقضات');
        } else {
          await supabaseServer
            .from('sheet_data')
            .insert({
              sheet_id:        discSheet.id,
              row_national_id: national_id ?? null,
              row_code:        employee_code ?? null,
              row_data:        discRowData,
              is_latest:       true,
              created_at:      now,
            });
          sideEffects.push('تمت إضافة الموظف إلى شيت المناقضات');
        }
      } else {
        sideEffects.push(discWarn ?? 'تنبيه: لم يتم العثور على شيت المناقضات في قاعدة البيانات (يمكن استيراده أولاً)');
      }
    }

    // ── 3. تم التوريد → update/insert in ارقام وارد التامين ─────────────
    if (insurance_status === 'تم التوريد') {
      const { sheet: incomingSheet, warning: incWarn } = await resolveSheetForEmployee({
        ilike: '%وارد%',
      });
      if (incWarn) sideEffects.push(incWarn);

      if (incomingSheet) {
        const { data: existingInc } = await supabaseServer
          .from('sheet_data')
          .select('id')
          .eq('sheet_id', incomingSheet.id)
          .or(`row_national_id.eq.${national_id || ''},row_code.eq.${employee_code || ''}`)
          .eq('is_latest', true)
          .limit(1)
          .maybeSingle();

        const incRowData = {
          الكود:             employee_code ?? '',
          الاسم:             employee_name ?? '',
          'الرقم القومى':    national_id ?? '',
          'الحاله':          'تم التوريد',
          'الحاله التامينية': insurance_status,
          _checklist_action:  'تم التوريد',
          _action_date:       now,
        };

        if (existingInc) {
          await supabaseServer
            .from('sheet_data')
            .update({ row_data: incRowData, updated_at: now })
            .eq('id', existingInc.id);
          sideEffects.push('تم تحديث حالة الموظف في شيت أرقام وارد التأمين');
        } else {
          await supabaseServer
            .from('sheet_data')
            .insert({
              sheet_id:        incomingSheet.id,
              row_national_id: national_id ?? null,
              row_code:        employee_code ?? null,
              row_data:        incRowData,
              is_latest:       true,
              created_at:      now,
            });
          sideEffects.push('تمت إضافة الموظف إلى شيت أرقام وارد التأمين');
        }
      }
    }

    // ── 4. Archives supply & documents update ────────────────────────────
    if (archives_supply_status || archives_supply_date || archives_docs) {
      const { sheet: archSheet, warning: archWarn } = await resolveSheetForEmployee({
        or: 'sheet_name.eq.Archives',
      });
      if (archWarn) sideEffects.push(archWarn);

      if (archSheet) {
        const { data: archRow } = await supabaseServer
          .from('sheet_data')
          .select('id, row_data')
          .eq('sheet_id', archSheet.id)
          .or(`row_national_id.eq.${national_id || ''},row_code.eq.${employee_code || ''}`)
          .eq('is_latest', true)
          .limit(1)
          .maybeSingle();

        const docMap: Record<string, string> = {};
        if (archives_docs && typeof archives_docs === 'object') {
          if (archives_docs.contract !== undefined) docMap['العقد'] = archives_docs.contract ? 'يوجد' : 'ناقص';
          if (archives_docs.idCard !== undefined) docMap['صوره بطاقه'] = archives_docs.idCard ? 'يوجد' : 'ناقص';
          if (archives_docs.qualification !== undefined) docMap['المؤهل'] = archives_docs.qualification ? 'يوجد' : 'ناقص';
          if (archives_docs.military !== undefined) docMap['الجيش'] = archives_docs.military ? 'يوجد' : 'ناقص';
          if (archives_docs.birthCertificate !== undefined) docMap['شهاده ميلاد'] = archives_docs.birthCertificate ? 'يوجد' : 'ناقص';
          if (archives_docs.workPermit !== undefined) docMap['كعب عمل'] = archives_docs.workPermit ? 'يوجد' : 'ناقص';
          if (archives_docs.criminalRecord !== undefined) docMap['فيش جنائى'] = archives_docs.criminalRecord ? 'يوجد' : 'ناقص';
          if (archives_docs.photos !== undefined) docMap['صور شخصيه'] = archives_docs.photos ? 'يوجد' : 'ناقص';
          if (archives_docs.skillTest !== undefined) docMap['قياس مهاره'] = archives_docs.skillTest ? 'يوجد' : 'ناقص';
          if (archives_docs.scan !== undefined) docMap['scan'] = archives_docs.scan ? 'يوجد' : 'ناقص';
        }

        const updatedRowData = {
          الكود:             employee_code ?? '',
          الاسم:             employee_name ?? '',
          'الرقم القومى':    national_id ?? '',
          ...(archRow ? (archRow.row_data as Record<string, unknown>) : {}),
          ...docMap,
          ...(archives_supply_status && archives_supply_status !== '—' ? { 'حاله التوريد': archives_supply_status } : {}),
          ...(archives_supply_date ? { 'تاريخ التوريد': archives_supply_date } : {}),
          _checklist_action: 'تحديث الأرشيف',
          _action_date:      now,
        };

        if (archRow) {
          await supabaseServer
            .from('sheet_data')
            .update({ row_data: updatedRowData, updated_at: now })
            .eq('id', archRow.id);
          sideEffects.push('تم تحديث حالة وثائق التوريد في شيت Archives');
        } else {
          await supabaseServer
            .from('sheet_data')
            .insert({
              sheet_id:        archSheet.id,
              row_national_id: national_id ?? null,
              row_code:        employee_code ?? null,
              row_data:        updatedRowData,
              is_latest:       true,
              created_at:      now,
            });
          sideEffects.push('تم إنشاء سجل موثق للموظف في شيت Archives');
        }
      }
    }

    // ── 5. RES ready or supplied for S6 ──────────────────────────────────
    if (res_ready_for_s6 === true || res_supplied_s6 === true) {
      const { sheet: resSheet, warning: resWarn } = await resolveSheetForEmployee({
        or: 'sheet_name.eq.RES.,sheet_name.eq.RES',
      });
      if (resWarn) sideEffects.push(resWarn);

      const resStateLabel = res_supplied_s6 ? 'تم التوريد' : 'جاهز لتوريد سن 6';

      if (resSheet) {
        const { data: existingRes } = await supabaseServer
          .from('sheet_data')
          .select('id, row_data')
          .eq('sheet_id', resSheet.id)
          .or(`row_national_id.eq.${national_id || ''},row_code.eq.${employee_code || ''}`)
          .eq('is_latest', true)
          .limit(1)
          .maybeSingle();

        const resRowData = {
          الكود:                 employee_code ?? '',
          الاسم:                 employee_name ?? '',
          'الرقم القومى':        national_id ?? '',
          'نوع توريد تامينات':   res_supply_type || 'يدوي',
          'تاريخ التوريد':       res_supply_date || now.split('T')[0],
          'تم الادخال بواسطه':   'نظام فحص غاز مصر',
          ...(existingRes ? (existingRes.row_data as Record<string, unknown>) : {}),
          'حالة استمارة س6':     resStateLabel,
          _s6_status:            resStateLabel,
          _action_date:          now,
        };

        if (existingRes) {
          await supabaseServer
            .from('sheet_data')
            .update({ row_data: resRowData, updated_at: now })
            .eq('id', existingRes.id);
        } else {
          await supabaseServer
            .from('sheet_data')
            .insert({
              sheet_id:        resSheet.id,
              row_national_id: national_id ?? null,
              row_code:        employee_code ?? null,
              row_data:        resRowData,
              is_latest:       true,
              created_at:      now,
            });
        }
      }

      // Also ensure updated in resignation_records table
      await supabaseServer
        .from('resignation_records')
        .update({
          insurance_supply_type: res_supply_type || 'يدوي',
          supply_date: res_supply_date || now.split('T')[0],
        })
        .or(orConds.join(','));

      sideEffects.push(`تم تأشير استمارة سن 6 كـ "${resStateLabel}" للموظف في شيت RES.`);
    }

    // ── 6. New employee sheet (ورقة الموظفين الجدد) ──────────────────────
    if (add_to_new_sheet === true && new_employee_data) {
      const { sheet: newSheet, warning: newWarn } = await resolveSheetForEmployee({
        or: 'sheet_name.eq.New',
      });
      if (newWarn) sideEffects.push(newWarn);

      if (newSheet) {
        const { data: existingNew } = await supabaseServer
          .from('sheet_data')
          .select('id')
          .eq('sheet_id', newSheet.id)
          .or(`row_national_id.eq.${national_id || ''},row_code.eq.${employee_code || ''}`)
          .eq('is_latest', true)
          .limit(1)
          .maybeSingle();

        // Exact column names of sheet 'New' from Egypt Gas
        const newRowData = {
          الاسم:             new_employee_data.name || employee_name || '',
          'الرقم القومى ':   new_employee_data.national_id || national_id || '',
          'الرقم التامينى ': new_employee_data.insurance_number || '',
          'رقم الهاتف ':     new_employee_data.phone || '',
          'الوظيفه ':        new_employee_data.job || '',
          'تاريخ الامضاء ':   new_employee_data.signing_date || now.split('T')[0],
          'العنوان ':        new_employee_data.address || '',
          الكود:             new_employee_data.code || employee_code || '',
          _checklist_action: 'إضافة/تحديث في New',
          _action_date:      now,
        };

        if (existingNew) {
          await supabaseServer
            .from('sheet_data')
            .update({ row_data: newRowData, updated_at: now })
            .eq('id', existingNew.id);
          sideEffects.push('تم تحديث بيانات الموظف في شيت New (الموظفين الجدد)');
        } else {
          await supabaseServer
            .from('sheet_data')
            .insert({
              sheet_id:        newSheet.id,
              row_national_id: national_id ?? null,
              row_code:        employee_code ?? null,
              row_data:        newRowData,
              is_latest:       true,
              created_at:      now,
            });
          sideEffects.push('تمت إضافة الموظف بنجاح إلى شيت New (الموظفين الجدد)');
        }
      }
    }

    // ── 7. Add a new Request to Requests sheet ───────────────────────────
    if (request_type) {
      const { sheet: reqSheet, warning: reqWarn } = await resolveSheetForEmployee({
        or: 'sheet_name.eq.Requests',
      });
      if (reqWarn) sideEffects.push(reqWarn);

      if (reqSheet) {
        await supabaseServer
          .from('sheet_data')
          .insert({
            sheet_id:        reqSheet.id,
            row_national_id: national_id ?? null,
            row_code:        employee_code ?? null,
            is_latest:       true,
            created_at:      now,
            row_data: {
              'الكود ':       employee_code ?? '',
              الاسم:          employee_name ?? '',
              'الرقم القومى ': national_id ?? '',
              'الطلب':        request_type,
              'الحاله':       request_status ?? 'جاري',
              'التاريخ ':     request_date ?? now.split('T')[0],
              'المستلم ':     request_receiver ?? 'قسم التأمينات',
              'ملاحضات ':     request_note ?? '',
              _action_date:   now,
            },
          });
        sideEffects.push(`تم إضافة طلب "${request_type}" إلى شيت Requests`);
      }
    }

    // ── 8. Synchronize with search_history for live daily audit reporting ──
    try {
      const { data: recentSearch } = await supabaseServer
        .from('search_history')
        .select('id, insurance_status, search_result')
        .or(orConds.join(','))
        .order('search_timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentSearch) {
        const existingResult = (recentSearch.search_result && typeof recentSearch.search_result === 'object')
          ? (recentSearch.search_result as Record<string, unknown>)
          : {};

        const updatedResult = {
          ...existingResult,
          checklist_action: {
            insurance_status,
            discrepancy_note: discrepancy_note || '',
            archives_supply_status: archives_supply_status || '',
            archives_supply_date: archives_supply_date || '',
            archives_docs: archives_docs || {},
            res_ready_for_s6: !!res_ready_for_s6,
            res_supplied_s6: !!res_supplied_s6,
            res_supply_date: res_supply_date || '',
            res_supply_type: res_supply_type || '',
            add_to_new_sheet: !!add_to_new_sheet,
            request_type: request_type || '',
            checklist_note: checklist_note || '',
            action_timestamp: now,
          },
        };

        await supabaseServer
          .from('search_history')
          .update({
            insurance_status: insurance_status || recentSearch.insurance_status,
            search_result: updatedResult as never,
          })
          .eq('id', recentSearch.id);
      }
    } catch (histErr) {
      console.warn('Could not update search_history row:', histErr);
    }

    // ── 7. Upsert checklist_records (main log table) ─────────────────────
    const checklistPayload = {
      national_id:             national_id   ?? null,
      employee_code:           employee_code ?? null,
      employee_name:           employee_name ?? null,
      insurance_status:        insurance_status    ?? null,
      discrepancy_note:        discrepancy_note    ?? null,
      archives_supply_status:  archives_supply_status ?? null,
      archives_supply_date:    archives_supply_date   ?? null,
      res_ready_for_s6:        res_ready_for_s6   ?? false,
      request_type:            request_type  ?? null,
      request_status:          request_status ?? null,
      request_date:            request_date   ?? null,
      request_note:            request_note   ?? null,
      add_to_new_sheet:        add_to_new_sheet ?? false,
      checklist_note:          checklist_note   ?? null,
      updated_at:              now,
    };

    // Try upsert into checklist_records (table may not exist yet — handle gracefully)
    const { error: clErr } = await (supabaseServer as unknown as { from: (table: string) => any })
      .from('checklist_records')
      .upsert(checklistPayload, {
        onConflict: national_id ? 'national_id' : 'employee_code',
        ignoreDuplicates: false,
      });

    if (clErr) {
      // Table might not exist yet — log and continue
      console.warn('checklist_records upsert failed (table may not exist):', clErr.message);
      sideEffects.push('تنبيه: جدول checklist_records غير موجود — البيانات حُفظت في جداول الأوراق الأخرى فقط');
    } else {
      sideEffects.push('تم حفظ القائمة في سجل اليوم بنجاح');
    }

    return NextResponse.json({
      success: true,
      message: 'تم حفظ القائمة بنجاح',
      sideEffects,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'خطأ في حفظ القائمة';
    console.error('POST /api/checklist error:', err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
