'use client';

import React, { useEffect, useState } from 'react';

interface TimelineEvent {
  at: string; kind: string; fields: string[] | null; old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null; by: string | null; reason: string | null; source: string | null;
}
interface Timeline {
  person_uid: string; operating_no: string | null;
  master: { employee_name: string; national_id: string | null; employee_code: string | null; company_account: string };
  numbers: { account: string; operating_no: string; assigned_at: string }[];
  latest: Record<string, Record<string, unknown> | null>;
  events: TimelineEvent[];
}

const KIND: Record<string, string> = {
  name_change: 'تعديل الاسم', identity_change: 'تعديل الرقم القومي / الكود', account_transfer: 'نقل بين الحسابات',
  stamp_correction: 'تصحيح الحساب', initial_import: 'أول تسجيل', data_update: 'تحديث بيانات', profile_change: 'تعديل بيانات الملف', insurance_job_change: 'تعديل المهنة التأمينية',
  'source_update:monthly_payroll_records': 'تحديث صف مرتبات', 'source_update:monthly_insurance_records': 'تحديث صف تأمين شهري',
  'source_update:incoming_insurance_records': 'تحديث صف الوارد', 'source_update:resignation_records': 'تحديث صف استقالة',
  'source_row_added:monthly_payroll_records': 'صف مرتبات جديد', 'source_row_added:monthly_insurance_records': 'صف تأمين شهري جديد',
  'source_row_added:incoming_insurance_records': 'صف وارد جديد', 'source_row_added:resignation_records': 'صف استقالة جديد',
};
const LATEST: Record<string, string> = { payroll: 'آخر مرتبات', monthly_insurance: 'آخر تأمين شهري', incoming: 'آخر وارد', resignation: 'آخر استقالة' };
const box: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14 };
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#e2e8f0', fontSize: 13 };
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

const CORE_FIELDS: [string, string][] = [['employee_name', 'الاسم'], ['national_id', 'الرقم القومي'], ['employee_code', 'كود الموظف في الحساب'], ['insurance_job_title', 'المهنة التأمينية (ثابتة، تتغير بتعديلك فقط)']];
const PROFILE_FIELDS: [string, string][] = [['current_status', 'الحالة'], ['current_job_title', 'المهنة (المرتبات)'], ['current_region', 'المنطقة'],
  ['current_department', 'القسم'], ['insurance_number', 'الرقم التأميني'], ['insurance_status', 'حالة التأمين'], ['insurance_salary', 'الأجر التأميني'],
  ['insurance_start_date', 'بداية الاشتراك'], ['hire_date', 'تاريخ التعيين'], ['resignation_date', 'تاريخ الاستقالة'], ['last_working_day', 'آخر يوم عمل'],
  ['phone_number', 'التليفون'], ['address', 'العنوان']];

export function EmployeeCoreEditor({ id, employee, onSaved }: { id: string; employee: Record<string, unknown>; onSaved?: () => void }) {
  const init = () => Object.fromEntries([...CORE_FIELDS, ...PROFILE_FIELDS].map(([k]) => [k, employee[k] === null || employee[k] === undefined ? '' : String(employee[k])]));
  const [vals, setVals] = useState<Record<string, string>>(init);
  const [by, setBy] = useState(''); const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const orig = init();

  const save = async () => {
    const changed: Record<string, string> = {};
    for (const k of Object.keys(vals)) if (vals[k] !== orig[k]) changed[k] = vals[k];
    if (Object.keys(changed).length === 0) { setMsg({ ok: true, text: 'لا يوجد تغيير' }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/employee/${id}/master`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...changed, confirmed_by: by, reason }) });
      const j = await r.json();
      if (!r.ok || !j.success) setMsg({ ok: false, text: j.message || j.error || 'فشل الحفظ' });
      else { setMsg({ ok: true, text: 'تم الحفظ وتسجل في السجل' }); onSaved?.(); }
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'فشل الحفظ' }); } finally { setBusy(false); }
  };
  const field = (k: string, label: string) => (
    <label key={k} style={{ fontSize: 12 }}>{label}
      <input style={inp} value={vals[k] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))} />
    </label>);
  return (
    <div style={{ ...box, marginBottom: 16 }} dir="rtl">
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 10 }}>تعديل بيانات الموظف (الماستر والملف الشخصي)</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        <label style={{ fontSize: 12 }}>الرقم الموحد (ثابت)<input style={{ ...inp, opacity: 0.7 }} value={String(employee.operating_no || employee.person_uid || '')} readOnly /></label>
        <label style={{ fontSize: 12 }}>الحساب (يتغير بالنقل فقط)<input style={{ ...inp, opacity: 0.7 }} value={String(employee.company_account || '')} readOnly /></label>
        {CORE_FIELDS.map(([k, l]) => field(k, l))}
      </div>
      <div style={{ fontWeight: 700, fontSize: 13, margin: '12px 0 6px' }}>باقي البيانات</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {PROFILE_FIELDS.map(([k, l]) => field(k, l))}
        <label style={{ fontSize: 12 }}>من يعدّل (مطلوب)<input style={inp} value={by} onChange={(e) => setBy(e.target.value)} /></label>
        <label style={{ fontSize: 12 }}>السبب (اختياري)<input style={inp} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={save} disabled={busy || !by.trim()} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, opacity: busy || !by.trim() ? 0.5 : 1 }}>
          {busy ? 'جاري الحفظ...' : 'حفظ التعديل'}
        </button>
        {msg && <span style={{ color: msg.ok ? '#34d399' : '#f87171', fontSize: 13 }}>{msg.text}</span>}
      </div>
    </div>
  );
}

export function EmployeeTimeline({ id }: { id: string }) {
  const [tl, setTl] = useState<Timeline | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { (async () => {
    try { const r = await fetch(`/api/employee/${id}/timeline`); if (!r.ok) throw new Error(await r.text()); setTl(await r.json()); }
    catch (e) { setErr(e instanceof Error ? e.message : 'فشل التحميل'); } })(); }, [id]);
  if (err) return <div style={{ color: '#f87171' }}>{err}</div>;
  if (!tl) return <div style={{ color: '#94a3b8' }}>جاري التحميل...</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} dir="rtl">
      <div style={box}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>آخر بيانات من كل مصدر</div>
        {Object.entries(tl.latest).map(([k, row]) => (
          <details key={k} style={{ marginBottom: 6 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13 }}>{LATEST[k] || k}{row ? '' : ' — لا يوجد'}</summary>
            {row && <div style={{ fontSize: 12, color: '#cbd5e1', padding: '6px 10px' }}>
              {Object.entries({ ...row, ...((row.raw_data as Record<string, unknown>) || {}) }).filter(([f]) => !['raw_data', 'id', 'import_id', 'person_id', 'identity_key', 'row_key'].includes(f) && row[f] !== '' ).map(([f, v]) => (
                <div key={f}><span style={{ color: '#94a3b8' }}>{f}:</span> {show(v)}</div>))}
            </div>}
          </details>))}
      </div>
      <div style={box}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>كل التغييرات (القديم ← الجديد)</div>
        {tl.events.length === 0 && <div style={{ color: '#94a3b8' }}>لا يوجد سجل تغييرات حتى الآن</div>}
        {tl.events.map((e, i) => {
          const keys = e.fields && e.fields.length ? e.fields : Object.keys(e.new_values || {});
          return (
            <div key={i} style={{ borderTop: i ? '1px solid rgba(255,255,255,0.06)' : 'none', padding: '8px 0' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
                <b style={{ color: '#818cf8' }}>{KIND[e.kind] || e.kind}</b>
                <span style={{ color: '#64748b' }}>{new Date(e.at).toLocaleString('ar-EG')}</span>
                {e.by && <span style={{ color: '#94a3b8' }}>بواسطة: {e.by}</span>}
                {e.source && <span style={{ color: '#94a3b8' }}>الملف: {e.source}</span>}
              </div>
              {keys.map((k) => (
                <div key={k} style={{ fontSize: 12, marginTop: 2 }}>
                  <span style={{ color: '#94a3b8' }}>{k}: </span>
                  {e.kind.startsWith('source_row_added') ? <span style={{ color: '#34d399' }}>{show(e.new_values?.[k])}</span> : <>
                    <span style={{ color: '#f87171', textDecoration: 'line-through' }}>{show(e.old_values?.[k])}</span>
                    {' ← '}<span style={{ color: '#34d399' }}>{show(e.new_values?.[k])}</span></>}
                </div>))}
              {e.reason && <div style={{ fontSize: 11, color: '#64748b' }}>السبب: {e.reason}</div>}
            </div>);
        })}
      </div>
    </div>
  );
}
