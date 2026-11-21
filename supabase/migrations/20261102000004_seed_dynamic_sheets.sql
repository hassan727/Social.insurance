-- Migration: Seed Dynamic Sheets with EGYPT GAS File Structure
-- Purpose: Register all 13 sheets from EGYPT GAS Excel file

-- ═══════════════════════════════════════════════════════════════════════════
-- INSERT SHEET DEFINITIONS
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Database (قاعدة البيانات الأساسية)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'Database',
    'قاعدة البيانات الأساسية',
    'الملف الرئيسي لبيانات الموظفين الأساسية',
    '[
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود", "كود", "code"]},
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم", "اسم الموظف", "name"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى", "الرقم القومي", "national_id"]},
        {"key": "job_title", "label": "الوظيفه", "type": "text", "aliases": ["الوظيفه", "الوظيفة", "job"]},
        {"key": "region", "label": "المنطقه", "type": "text", "aliases": ["المنطقه", "المنطقة", "region"]},
        {"key": "department", "label": "الاداره", "type": "text", "aliases": ["الاداره", "الإدارة", "الادارة", "department"]},
        {"key": "hire_date", "label": "تاريخ استلام العمل", "type": "date", "aliases": ["تاريخ استلام العمل", "تاريخ الاستلام"]},
        {"key": "address", "label": "العنوان", "type": "text", "aliases": ["العنوان", "address"]},
        {"key": "phone_number", "label": "رقم الهاتف", "type": "text", "aliases": ["رقم الهاتف", "التليفون", "phone"]},
        {"key": "status", "label": "الحاله", "type": "text", "aliases": ["الحاله", "الحالة", "status"]},
        {"key": "note", "label": "NOTE", "type": "text", "aliases": ["NOTE", "note", "ملاحظات", "ملاحظة"]}
    ]'::jsonb,
    ARRAY['employee_code', 'national_id', 'employee_name'],
    'employee_code',
    true,
    true, -- Master source
    'merge',
    11
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    matching_keys = EXCLUDED.matching_keys,
    updated_at = NOW();

-- 2. Archives (الأرشيف)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'Archives',
    'أرشيف المستندات',
    'حفظ حالة المستندات والأوراق الرسمية',
    '[
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود", "كود", "code"]},
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى", "الرقم القومي"]},
        {"key": "job_title", "label": "الوظيفه", "type": "text", "aliases": ["الوظيفه", "الوظيفة"]},
        {"key": "contract", "label": "العقد", "type": "text", "aliases": ["العقد"]},
        {"key": "id_card", "label": "صوره بطاقه", "type": "text", "aliases": ["صوره بطاقه", "صورة بطاقة"]},
        {"key": "qualification", "label": "المؤهل", "type": "text", "aliases": ["المؤهل"]},
        {"key": "military", "label": "الجيش", "type": "text", "aliases": ["الجيش"]},
        {"key": "birth_certificate", "label": "شهاده ميلاد", "type": "text", "aliases": ["شهاده ميلاد", "شهادة ميلاد"]},
        {"key": "work_permit", "label": "كعب عمل", "type": "text", "aliases": ["كعب عمل"]},
        {"key": "criminal_record", "label": "فيش جنائى", "type": "text", "aliases": ["فيش جنائى", "فيش جنائي"]},
        {"key": "photos", "label": "صور شخصيه", "type": "text", "aliases": ["صور شخصيه", "صور شخصية"]},
        {"key": "skill_test", "label": "قياس مهاره", "type": "text", "aliases": ["قياس مهاره", "قياس مهارة"]},
        {"key": "scan", "label": "scan", "type": "text", "aliases": ["scan"]}
    ]'::jsonb,
    ARRAY['employee_code', 'national_id'],
    'employee_code',
    true,
    false,
    'merge',
    14
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    updated_at = NOW();

-- 3. New (موظفين جدد)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'New',
    'موظفين جدد',
    'موظفين جدد بدون كود أداء',
    '[
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى", "الرقم القومي"]},
        {"key": "insurance_number", "label": "الرقم التامينى", "type": "text", "aliases": ["الرقم التامينى", "الرقم التأميني"]},
        {"key": "phone_number", "label": "رقم الهاتف", "type": "text", "aliases": ["رقم الهاتف"]},
        {"key": "job_title", "label": "الوظيفه", "type": "text", "aliases": ["الوظيفه", "الوظيفة"]},
        {"key": "signature_date", "label": "تاريخ الامضاء", "type": "date", "aliases": ["تاريخ الامضاء", "تاريخ الإمضاء"]},
        {"key": "address", "label": "العنوان", "type": "text", "aliases": ["العنوان"]},
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود", "كود"]}
    ]'::jsonb,
    ARRAY['national_id', 'employee_name'],
    'national_id',
    true,
    false,
    'merge',
    8
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    updated_at = NOW();

-- 4. RES (الاستقالات)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'RES',
    'ملف الاستقالات',
    'سجل الاستقالات وآخر يوم عمل',
    '[
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود", "كود"]},
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى", "الرقم القومي"]},
        {"key": "resignation_date", "label": "تاريخ الاستقاله", "type": "date", "aliases": ["تاريخ الاستقاله", "تاريخ الاستقالة"]},
        {"key": "last_working_day", "label": "اخر يوم عمل", "type": "date", "aliases": ["اخر يوم عمل", "آخر يوم عمل"]},
        {"key": "resignation_type", "label": "نوع الاستقاله", "type": "text", "aliases": ["نوع الاستقاله", "نوع الاستقالة"]},
        {"key": "insurance_supply_type", "label": "نوع توريد تامينات", "type": "text", "aliases": ["نوع توريد تامينات", "نوع توريد تأمينات"]},
        {"key": "supply_date", "label": "تاريخ التوريد", "type": "date", "aliases": ["تاريخ التوريد"]}
    ]'::jsonb,
    ARRAY['employee_code', 'national_id'],
    'employee_code',
    true,
    false,
    'replace', -- Replace old resignation data
    8
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    updated_at = NOW();

-- 5. Social.insurance (التأمينات الاجتماعية)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'Social.insurance',
    'التأمينات الاجتماعية',
    'بيانات التأمينات الأساسية',
    '[
        {"key": "seq", "label": "بلب", "type": "number", "aliases": ["بلب", "#"]},
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود"]},
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى"]},
        {"key": "insurance_status", "label": "الحاله التامينيه", "type": "text", "aliases": ["الحاله التامينيه", "الحالة التأمينية"]},
        {"key": "insurance_number", "label": "الرقم التامينى", "type": "text", "aliases": ["الرقم التامينى", "الرقم التأميني"]},
        {"key": "insurance_salary", "label": "الاجر التامينى", "type": "currency", "aliases": ["الاجر التامينى", "الأجر التأميني"]},
        {"key": "insurance_job_title", "label": "الوظيفه في التامينات", "type": "text", "aliases": ["الوظيفه في التامينات", "الوظيفة في التأمينات"]},
        {"key": "subscription_start_date", "label": "تاريخ بدايه الاشتراك", "type": "date", "aliases": ["تاريخ بدايه الاشتراك", "تاريخ بداية الاشتراك"]},
        {"key": "supply_method", "label": "طريقه التوريد", "type": "text", "aliases": ["طريقه التوريد", "طريقة التوريد"]},
        {"key": "crm_number", "label": "رقم ال CRM", "type": "text", "aliases": ["رقم ال CRM"]},
        {"key": "date", "label": "التاريخ", "type": "date", "aliases": ["التاريخ"]},
        {"key": "note", "label": "note", "type": "text", "aliases": ["note", "ملاحظة"]}
    ]'::jsonb,
    ARRAY['employee_code', 'national_id', 'insurance_number'],
    'employee_code',
    true,
    false,
    'merge',
    13
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    updated_at = NOW();

-- 6. Requests (طلبات الموظفين)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'Requests',
    'طلبات الموظفين',
    'سجل طلبات الموظفين',
    '[
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود"]},
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى"]},
        {"key": "request_type", "label": "الطلب", "type": "text", "aliases": ["الطلب"]},
        {"key": "request_status", "label": "الحاله", "type": "text", "aliases": ["الحاله", "الحالة"]},
        {"key": "request_date", "label": "التاريخ", "type": "date", "aliases": ["التاريخ"]},
        {"key": "received_by", "label": "المستلم", "type": "text", "aliases": ["المستلم"]},
        {"key": "notes", "label": "ملاحضات", "type": "text", "aliases": ["ملاحضات", "ملاحظات"]}
    ]'::jsonb,
    ARRAY['employee_code', 'national_id'],
    'employee_code',
    true,
    false,
    'append', -- Append new requests
    8
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    updated_at = NOW();

-- 7. HR Letter (الكوارترات)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'HR Letter',
    'HR Letter والكوارترات',
    'متوسطات الرواتب الربع سنوية',
    '[
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود"]},
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى"]},
        {"key": "job_title", "label": "الوظيفه", "type": "text", "aliases": ["الوظيفه"]},
        {"key": "insurance_job_title", "label": "الوظيفه في التامينات", "type": "text", "aliases": ["الوظيفه في التامينات"]},
        {"key": "subscription_start_date", "label": "تاريخ بدايه الاشتراك", "type": "date", "aliases": ["تاريخ بدايه الاشتراك"]},
        {"key": "insurance_salary", "label": "الاجر التامينى", "type": "currency", "aliases": ["الاجر التامينى"]},
        {"key": "avg_q1", "label": "متوسط Q1", "type": "currency", "aliases": ["متوسط Q1"]},
        {"key": "avg_q2", "label": "متوسط Q2", "type": "currency", "aliases": ["متوسط Q2"]},
        {"key": "avg_q3", "label": "متوسط Q3", "type": "currency", "aliases": ["متوسط Q3"]},
        {"key": "avg_q4", "label": "متوسط Q4", "type": "currency", "aliases": ["متوسط Q4"]}
    ]'::jsonb,
    ARRAY['employee_code', 'national_id'],
    'employee_code',
    true,
    false,
    'merge',
    11
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    updated_at = NOW();

-- 8. Medical (الكشف الطبي)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'Medical',
    'الكشف الطبي والبطاقات',
    'بيانات الكشف الطبي والبطاقات العلاجية',
    '[
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود"]},
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى"]},
        {"key": "job_title", "label": "الوظيفه", "type": "text", "aliases": ["الوظيفه"]},
        {"key": "department", "label": "الاداره", "type": "text", "aliases": ["الاداره", "الإدارة"]},
        {"key": "form_111", "label": "111", "type": "text", "aliases": ["111"]},
        {"key": "medical_card", "label": "بطاقه علاجيه", "type": "text", "aliases": ["بطاقه علاجيه", "بطاقة علاجية"]},
        {"key": "receive_date", "label": "تاريخ الاستلام", "type": "date", "aliases": ["تاريخ الاستلام"]},
        {"key": "issue_date", "label": "تاريخ الإصدار", "type": "date", "aliases": ["تاريخ الإصدار", "تاريخ الاصدار"]},
        {"key": "renewal_1", "label": "التجديد الأول", "type": "text", "aliases": ["التجديد الأول", "التجديد الاول"]},
        {"key": "renewal_2", "label": "التجديد التانى", "type": "text", "aliases": ["التجديد التانى", "التجديد الثاني"]},
        {"key": "private_medical", "label": "برايفت ميديكال", "type": "text", "aliases": ["برايفت ميديكال"]},
        {"key": "batch", "label": "الدفعه", "type": "text", "aliases": ["الدفعه", "الدفعة"]},
        {"key": "send_date", "label": "تاريخ الارسال", "type": "date", "aliases": ["تاريخ الارسال", "تاريخ الإرسال"]}
    ]'::jsonb,
    ARRAY['employee_code', 'national_id'],
    'employee_code',
    true,
    false,
    'merge',
    14
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    updated_at = NOW();

-- 9. Bank ACC. (الحسابات البنكية)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'Bank ACC.',
    'الحسابات البنكية',
    'حسابات الموظفين البنكية',
    '[
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى"]},
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم"]},
        {"key": "saib", "label": "SAIB", "type": "text", "aliases": ["SAIB"]},
        {"key": "cib", "label": "CIB", "type": "text", "aliases": ["CIB"]},
        {"key": "adib", "label": "ADIB", "type": "text", "aliases": ["ADIB"]},
        {"key": "dopay", "label": "DOPAY", "type": "text", "aliases": ["DOPAY"]},
        {"key": "bank_transfer", "label": "Bank Transfer", "type": "text", "aliases": ["Bank Transfer"]}
    ]'::jsonb,
    ARRAY['employee_code', 'national_id'],
    'employee_code',
    true,
    false,
    'merge',
    8
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    updated_at = NOW();

-- 10. Deductions (الاستقطاعات)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'Deductions',
    'الاستقطاعات',
    'استقطاعات الموظفين (نفقات وغيرها)',
    '[
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود"]},
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى"]},
        {"key": "job_title", "label": "الوظيفه", "type": "text", "aliases": ["الوظيفه"]},
        {"key": "department", "label": "الاداره", "type": "text", "aliases": ["الاداره"]},
        {"key": "deduction_type", "label": "نوع الاستقطاع", "type": "text", "aliases": ["نوع الاستقطاع"]},
        {"key": "amount", "label": "المبلغ", "type": "currency", "aliases": ["المبلغ"]},
        {"key": "beneficiary", "label": "المستفيد", "type": "text", "aliases": ["المستفيد"]}
    ]'::jsonb,
    ARRAY['employee_code', 'national_id'],
    'employee_code',
    true,
    false,
    'merge',
    8
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    updated_at = NOW();

-- 11. ارقام وارد التامين (حركة التأمينات - مهم جداً)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'ارقام وارد التامين',
    'أرقام وارد التأمين',
    'حركة التأمينات - أهم ورقة لتتبع حالة التأمينات',
    '[
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود"]},
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى"]},
        {"key": "job_title", "label": "الوظيفه", "type": "text", "aliases": ["الوظيفه"]},
        {"key": "status", "label": "الحاله", "type": "text", "aliases": ["الحاله", "الحالة"]},
        {"key": "company_account", "label": "الشركه", "type": "text", "aliases": ["الشركه", "الشركة", "Account"]},
        {"key": "insurance_number", "label": "الرقم التاميني", "type": "text", "aliases": ["الرقم التاميني", "الرقم التأميني"]},
        {"key": "insurance_status", "label": "الحاله التامينية", "type": "text", "aliases": ["الحاله التامينية", "الحالة التأمينية"]},
        {"key": "termination_reason", "label": "سبب الانتهاء", "type": "text", "aliases": ["سبب الانتهاء"]},
        {"key": "form_type", "label": "نوع الاستماره", "type": "text", "aliases": ["نوع الاستماره", "نوع الاستمارة"]},
        {"key": "insurance_job_title", "label": "الوظيفه في التامينات", "type": "text", "aliases": ["الوظيفه في التامينات"]},
        {"key": "subscription_start_date", "label": "تاريخ بدايه الاشتراك", "type": "date", "aliases": ["تاريخ بدايه الاشتراك"]},
        {"key": "subscription_end_date", "label": "تاريخ نهاية الاشتراك", "type": "date", "aliases": ["تاريخ نهاية الاشتراك"]},
        {"key": "supply_method", "label": "طريقه التوريد", "type": "text", "aliases": ["طريقه التوريد"]},
        {"key": "crm_number", "label": "رقم ال CRM", "type": "text", "aliases": ["رقم ال CRM"]},
        {"key": "date", "label": "التاريخ", "type": "date", "aliases": ["التاريخ"]},
        {"key": "note", "label": "note", "type": "text", "aliases": ["note"]}
    ]'::jsonb,
    ARRAY['employee_code', 'national_id', 'company_account'],
    'employee_code',
    true,
    true, -- Important master source for insurance movements
    'merge',
    17
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    updated_at = NOW();

-- 12. شغل تامينات (بيانات شهرية)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'شغل تامينات',
    'شغل تأمينات شهري',
    'بيانات التأمينات الشهرية لعدة أشهر',
    '[
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود"]},
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى"]},
        {"key": "insurance_status", "label": "الحاله التامينيه", "type": "text", "aliases": ["الحاله التامينيه"]},
        {"key": "insurance_number", "label": "الرقم التامينى", "type": "text", "aliases": ["الرقم التامينى"]},
        {"key": "job_title", "label": "الوظيفه", "type": "text", "aliases": ["الوظيفه"]},
        {"key": "insurance_job_title", "label": "الوظيفه في التامينات", "type": "text", "aliases": ["الوظيفه في التامينات"]},
        {"key": "month_5", "label": "شهر 5", "type": "number", "aliases": ["شهر 5"]},
        {"key": "month_6", "label": "شهر 6", "type": "number", "aliases": ["شهر 6"]},
        {"key": "month_7", "label": "شهر 7", "type": "number", "aliases": ["شهر 7"]},
        {"key": "work_months_count", "label": "عدد اشهر العمل", "type": "number", "aliases": ["عدد اشهر العمل"]},
        {"key": "total_salary", "label": "الاجر الشامل", "type": "currency", "aliases": ["الاجر الشامل"]},
        {"key": "insurance_salary", "label": "الاجر التامينى", "type": "currency", "aliases": ["الاجر التامينى"]},
        {"key": "note", "label": "note", "type": "text", "aliases": ["note"]}
    ]'::jsonb,
    ARRAY['employee_code', 'national_id'],
    'employee_code',
    true,
    false,
    'merge',
    14
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    updated_at = NOW();

-- 13. المنقاضات (النواقص)
INSERT INTO public.dynamic_sheets (
    sheet_name, display_name, description, column_definitions, matching_keys, 
    primary_key_field, is_active, is_master_source, update_strategy, total_columns
) VALUES (
    'المنقاضات',
    'شيت المنقاضات والنواقص',
    'متابعة النواقص والمتطلبات للموظفين',
    '[
        {"key": "seq", "label": "#", "type": "number", "aliases": ["#"]},
        {"key": "employee_code", "label": "الكود", "type": "text", "aliases": ["الكود"]},
        {"key": "employee_name", "label": "الاسم", "type": "text", "aliases": ["الاسم"]},
        {"key": "national_id", "label": "الرقم القومى", "type": "text", "aliases": ["الرقم القومى"]},
        {"key": "job_title", "label": "الوظيفه", "type": "text", "aliases": ["الوظيفه"]},
        {"key": "region", "label": "المنطقه", "type": "text", "aliases": ["المنطقه"]},
        {"key": "actual_location", "label": "الموقع الفعلى", "type": "text", "aliases": ["الموقع الفعلى", "الموقع الفعلي"]},
        {"key": "hire_date", "label": "تاريخ استلام العمل", "type": "date", "aliases": ["تاريخ استلام العمل"]},
        {"key": "phone_number", "label": "رقم الهاتف", "type": "text", "aliases": ["رقم الهاتف"]},
        {"key": "status", "label": "الحاله", "type": "text", "aliases": ["الحاله", "الحالة"]},
        {"key": "note", "label": "NOTE", "type": "text", "aliases": ["NOTE", "note"]}
    ]'::jsonb,
    ARRAY['employee_code', 'national_id'],
    'employee_code',
    true,
    false,
    'merge',
    11
) ON CONFLICT (sheet_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    column_definitions = EXCLUDED.column_definitions,
    updated_at = NOW();

-- Success message
DO $$ 
BEGIN 
    RAISE NOTICE 'Successfully seeded 13 dynamic sheets for EGYPT GAS file structure';
END $$;
