'use client';

import React, { useState, useCallback } from 'react';
import {
  CheckCircle2, XCircle, AlertTriangle, ChevronDown, Save,
  FileCheck, FolderCheck, FileText, Clipboard, UserPlus,
  RefreshCw, Info, Shield, Clock, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { EmployeeDetailsResult } from '@/lib/lookupService';

// ══════════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════════
export type InsuranceStatusOption =
  | 'تم التجهيز'
  | 'جاري التأمين'
  | 'مؤمن عليه'
  | 'مناقضة'
  | 'تم التوريد';

export interface ArchivesDocState {
  contract: boolean;
  idCard: boolean;
  qualification: boolean;
  military: boolean;
  birthCertificate: boolean;
  workPermit: boolean;
  criminalRecord: boolean;
  photos: boolean;
  skillTest: boolean;
  scan: boolean;
}

export interface NewEmployeeData {
  name: string;
  national_id: string;
  insurance_number: string;
  phone: string;
  job: string;
  signing_date: string;
  address: string;
  code: string;
}

interface ChecklistState {
  // Social Insurance
  insurance_status: InsuranceStatusOption;
  discrepancy_note: string;
  // Archives
  archives_docs: ArchivesDocState;
  archives_supply_status: string;
  archives_supply_date: string;
  // RES
  res_ready_for_s6: boolean;
  res_supplied_s6: boolean;
  res_supply_date: string;
  res_supply_type: string;
  res_notes: string;
  // New employee sheet
  add_to_new_sheet: boolean;
  new_employee_data: NewEmployeeData;
  // Requests
  request_type: string;
  request_status: string;
  request_date: string;
  request_receiver: string;
  request_note: string;
  // General note
  checklist_note: string;
}

interface Props {
  details: EmployeeDetailsResult;
}

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════
const INSURANCE_OPTIONS: { value: InsuranceStatusOption; label: string; color: string; bg: string; border: string; desc: string }[] = [
  {
    value: 'تم التجهيز',
    label: '✅ تم التجهيز',
    color: '#34d399',
    bg: 'rgba(52,211,153,0.1)',
    border: 'rgba(52,211,153,0.4)',
    desc: 'الديفولت — الاستمارة موجودة ومجهزة',
  },
  {
    value: 'جاري التأمين',
    label: '🔄 جاري التأمين',
    color: '#38bdf8',
    bg: 'rgba(56,189,248,0.1)',
    border: 'rgba(56,189,248,0.4)',
    desc: 'الاستمارة اتبعتت وشغالة',
  },
  {
    value: 'مؤمن عليه',
    label: '🛡️ مؤمن عليه',
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.1)',
    border: 'rgba(167,139,250,0.4)',
    desc: 'لديه رقم تأميني فعلاً — بناءً على برنت العمالة',
  },
  {
    value: 'مناقضة',
    label: '⚠️ مناقضة',
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.1)',
    border: 'rgba(251,191,36,0.4)',
    desc: 'فيه مشكلة — يضاف لشيت المناقضات',
  },
  {
    value: 'تم التوريد',
    label: '📤 تم التوريد',
    color: '#818cf8',
    bg: 'rgba(129,140,248,0.1)',
    border: 'rgba(129,140,248,0.4)',
    desc: 'تم التوريد الفعلي — يحدث شيت أرقام وارد التأمين',
  },
];

const ARCHIVES_SUPPLY_OPTIONS = ['—', 'تم التوريد', 'جاري التوريد', 'ناقص', 'لم يورد'];
const REQUEST_TYPES = [
  'شهادة راتب', 'شهادة خدمة', 'خطاب بنك', 'خطاب سفارة',
  'صورة عقد', 'بدل فاقد', 'تعديل بيانات', 'أخرى',
];

function today() {
  return new Date().toISOString().split('T')[0];
}

// ══════════════════════════════════════════════════════════════════
// SECTION HEADER
// ══════════════════════════════════════════════════════════════════
function SectionHeader({
  icon: Icon,
  title,
  badge,
  badgeColor = '#818cf8',
  expanded,
  onToggle,
}: {
  icon: React.ElementType;
  title: string;
  badge?: string;
  badgeColor?: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '12px 16px',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: expanded ? '14px 14px 0 0' : 14,
        cursor: 'pointer',
        textAlign: 'right',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon style={{ width: 18, height: 18, color: badgeColor, flexShrink: 0 }} />
        <span style={{ fontSize: 14, fontWeight: 800, color: '#f1f5f9' }}>{title}</span>
        {badge && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
            background: `${badgeColor}22`, color: badgeColor,
            border: `1px solid ${badgeColor}44`,
          }}>
            {badge}
          </span>
        )}
      </div>
      <ChevronDown
        style={{
          width: 16, height: 16, color: '#64748b',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease',
        }}
      />
    </button>
  );
}

// ══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════
export default function EmployeeChecklistPanel({ details }: Props) {
  const emp = details.identifiers;
  const hasResignation = details.resignation?.found ?? false;
  const archDocs = details.unifiedProfile?.archives;
  const socInsStatus = details.unifiedProfile?.socialInsuranceSheet?.insuranceStatus ?? '';

  // Derive default insurance status from existing data
  const deriveDefaultStatus = (): InsuranceStatusOption => {
    if (socInsStatus) {
      const s = socInsStatus.trim();
      if (s.includes('تم التوريد')) return 'تم التوريد';
      if (s.includes('جاري')) return 'جاري التأمين';
      if (s.includes('مناقضة')) return 'مناقضة';
      if (s.includes('مؤمن')) return 'مؤمن عليه';
      if (s.includes('تم التجهيز')) return 'تم التجهيز';
    }
    return 'تم التجهيز'; // Default
  };

  function isDocPresent(val: unknown): boolean {
    if (val === true) return true;
    const s = String(val || '').toLowerCase().trim();
    return s.includes('يوجد') || s.includes('اصل') || s.includes('أصل') || s.includes('صوره') || s.includes('صورة') || s === 'scan' || s === 'نعم' || s === 'true';
  }

  const [state, setState] = useState<ChecklistState>({
    insurance_status: deriveDefaultStatus(),
    discrepancy_note: '',
    archives_docs: {
      contract: isDocPresent(archDocs?.contract),
      idCard: isDocPresent(archDocs?.idCard),
      qualification: isDocPresent(archDocs?.qualification),
      military: isDocPresent(archDocs?.military),
      birthCertificate: isDocPresent(archDocs?.birthCertificate),
      workPermit: isDocPresent(archDocs?.workPermit),
      criminalRecord: isDocPresent(archDocs?.criminalRecord),
      photos: isDocPresent(archDocs?.photos),
      skillTest: isDocPresent(archDocs?.skillTest),
      scan: isDocPresent(archDocs?.scan),
    },
    archives_supply_status: String(archDocs?.raw?.['حاله التوريد'] || '—'),
    archives_supply_date: String(archDocs?.raw?.['تاريخ التوريد'] || today()),
    res_ready_for_s6: false,
    res_supplied_s6: false,
    res_supply_date: today(),
    res_supply_type: 'يدوي',
    res_notes: '',
    add_to_new_sheet: false,
    new_employee_data: {
      name: emp.employee_name || '',
      national_id: emp.national_id || '',
      insurance_number: details.unifiedProfile?.socialInsuranceSheet?.insuranceNumber || '',
      phone: details.unifiedProfile?.phoneNumber || '',
      job: details.unifiedProfile?.jobTitle || '',
      signing_date: today(),
      address: details.unifiedProfile?.address || '',
      code: emp.employee_code || '',
    },
    request_type: '',
    request_status: 'جاري',
    request_date: today(),
    request_receiver: 'قسم التأمينات',
    request_note: '',
    checklist_note: '',
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sections open/close
  const [openSections, setOpenSections] = useState({
    social: true,
    archives: false,
    res: hasResignation,
    newEmp: false,
    requests: false,
    note: false,
  });

  const toggleSection = (k: keyof typeof openSections) =>
    setOpenSections((p) => ({ ...p, [k]: !p[k] }));

  const update = useCallback(<K extends keyof ChecklistState>(key: K, val: ChecklistState[K]) => {
    setState((p) => ({ ...p, [key]: val }));
    setSaved(false);
  }, []);

  const toggleDoc = (docKey: keyof ArchivesDocState) => {
    setState((p) => ({
      ...p,
      archives_docs: {
        ...p.archives_docs,
        [docKey]: !p.archives_docs[docKey],
      },
    }));
    setSaved(false);
  };

  const updateNewEmp = <K extends keyof NewEmployeeData>(field: K, val: string) => {
    setState((p) => ({
      ...p,
      new_employee_data: { ...p.new_employee_data, [field]: val },
    }));
    setSaved(false);
  };

  // ── Save ──────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        national_id: emp.national_id,
        employee_code: emp.employee_code,
        employee_name: emp.employee_name,
        ...state,
        // Only send request fields if request_type is filled
        request_type: state.request_type || undefined,
        request_status: state.request_type ? state.request_status : undefined,
        request_date: state.request_type ? state.request_date : undefined,
        request_receiver: state.request_type ? state.request_receiver : undefined,
        request_note: state.request_type ? state.request_note : undefined,
        // Only send archives fields if changed
        archives_supply_status: state.archives_supply_status !== '—' ? state.archives_supply_status : undefined,
        archives_supply_date: state.archives_supply_status !== '—' ? state.archives_supply_date : undefined,
      };

      const res = await fetch('/api/checklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'فشل الحفظ');
      }

      setSaved(true);
      toast.success(`تم حفظ القائمة — ${state.insurance_status}`);

      if (data.sideEffects?.length) {
        data.sideEffects.forEach((msg: string) => toast.info(msg, { duration: 4000 }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطأ في الحفظ';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const selectedOpt = INSURANCE_OPTIONS.find((o) => o.value === state.insurance_status)!;

  // ── RENDER ────────────────────────────────────────────────────
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(10,18,35,0.99) 100%)',
        border: '1.5px solid rgba(129,140,248,0.3)',
        borderRadius: 22,
        padding: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(129,140,248,0.2)', border: '1px solid rgba(129,140,248,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Clipboard style={{ width: 22, height: 22, color: '#818cf8' }} />
          </div>
          <div>
            <h3 style={{ fontSize: 17, fontWeight: 900, color: '#ffffff', margin: 0 }}>
              قائمة التأشيرات والإجراءات
            </h3>
            <p style={{ fontSize: 11, color: '#64748b', margin: '2px 0 0' }}>
              {emp.employee_name} — {emp.national_id || emp.employee_code}
            </p>
          </div>
        </div>

        {/* Current status badge */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 14px', borderRadius: 10,
          background: selectedOpt.bg, color: selectedOpt.color,
          border: `1.5px solid ${selectedOpt.border}`,
          fontSize: 12, fontWeight: 800,
        }}>
          {selectedOpt.label}
        </span>
      </div>

      {/* ════════════════════════════════════════════════════════
          SECTION 1 — Social Insurance Status
      ════════════════════════════════════════════════════════ */}
      <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
        <SectionHeader
          icon={Shield}
          title="الحالة التأمينية (Social Insurance)"
          badge="الأهم"
          badgeColor="#38bdf8"
          expanded={openSections.social}
          onToggle={() => toggleSection('social')}
        />

        {openSections.social && (
          <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Status cards grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
              {INSURANCE_OPTIONS.map((opt) => {
                const isSelected = state.insurance_status === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => update('insurance_status', opt.value)}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: isSelected ? opt.bg : 'rgba(255,255,255,0.02)',
                      border: `2px solid ${isSelected ? opt.border : 'rgba(255,255,255,0.08)'}`,
                      cursor: 'pointer',
                      textAlign: 'right',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? `0 0 12px ${opt.border}` : 'none',
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 800, color: isSelected ? opt.color : '#94a3b8' }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: 10, color: isSelected ? opt.color : '#475569', marginTop: 3, opacity: 0.8 }}>
                      {opt.desc}
                    </div>
                    {isSelected && (
                      <CheckCircle2 style={{ width: 14, height: 14, color: opt.color, marginTop: 6 }} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Discrepancy note (shown only when مناقضة selected) */}
            {state.insurance_status === 'مناقضة' && (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'rgba(251,191,36,0.08)',
                  border: '1px solid rgba(251,191,36,0.4)',
                }}
              >
                <label style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24', display: 'block', marginBottom: 8 }}>
                  ⚠️ نوع / سبب المناقضة (مطلوب)
                </label>
                <textarea
                  value={state.discrepancy_note}
                  onChange={(e) => update('discrepancy_note', e.target.value)}
                  placeholder="مثال: ناقص ظهر الطاقة — أو — رقم قومي خطأ — أو — استيفاء الأوراق ناقص..."
                  rows={2}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(251,191,36,0.3)',
                    color: '#fde68a',
                    fontSize: 13,
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <div style={{ fontSize: 11, color: '#92400e', marginTop: 6 }}>
                  <Info style={{ width: 12, height: 12, display: 'inline', marginLeft: 4 }} />
                  سيتم إضافة الموظف تلقائياً إلى شيت المناقضات
                </div>
              </div>
            )}

            {/* تم التوريد info */}
            {state.insurance_status === 'تم التوريد' && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(129,140,248,0.08)', border: '1px solid rgba(129,140,248,0.3)', fontSize: 11, color: '#a5b4fc' }}>
                <Info style={{ width: 12, height: 12, display: 'inline', marginLeft: 4 }} />
                سيتم تحديث شيت أرقام وارد التأمين تلقائياً عند الحفظ
              </div>
            )}

            {/* مؤمن عليه info */}
            {state.insurance_status === 'مؤمن عليه' && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.3)', fontSize: 11, color: '#c4b5fd' }}>
                <Info style={{ width: 12, height: 12, display: 'inline', marginLeft: 4 }} />
                مؤمن عليه = موجود فعلاً في سجلات برنت العمالة
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
          SECTION 2 — Archives (حالة توريد الأوراق والمستندات)
      ════════════════════════════════════════════════════════ */}
      {(() => {
        const docKeys: { key: keyof ArchivesDocState; label: string }[] = [
          { key: 'contract', label: 'العقد' },
          { key: 'idCard', label: 'صورة البطاقة' },
          { key: 'qualification', label: 'المؤهل' },
          { key: 'military', label: 'الجيش' },
          { key: 'birthCertificate', label: 'شهادة ميلاد' },
          { key: 'workPermit', label: 'كعب عمل' },
          { key: 'criminalRecord', label: 'الفيش الجنائي' },
          { key: 'photos', label: 'صور شخصية' },
          { key: 'skillTest', label: 'قياس مهارة' },
          { key: 'scan', label: 'Scan' },
        ];
        const presentCount = docKeys.filter((d) => state.archives_docs[d.key]).length;
        const compScore = Math.round((presentCount / docKeys.length) * 100);

        return (
          <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
            <SectionHeader
              icon={FolderCheck}
              title="الأرشيف — استيفاء المستندات وحالة التوريد"
              badge={`اكتمال ${compScore}% (${presentCount}/${docKeys.length})`}
              badgeColor={compScore >= 80 ? '#34d399' : compScore >= 50 ? '#fbbf24' : '#f87171'}
              expanded={openSections.archives}
              onToggle={() => toggleSection('archives')}
            />

            {openSections.archives && (
              <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Info style={{ width: 13, height: 13, color: '#38bdf8' }} />
                  <span>انقر على أي مستند لتبديل حالة الاستيفاء (تشيك مارك ديناميكي لتحديث ورقة الأرشيف):</span>
                </div>

                {/* Interactive documents grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                  {docKeys.map(({ key, label }) => {
                    const isChecked = !!state.archives_docs[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleDoc(key)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          background: isChecked ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.08)',
                          border: `1.5px solid ${isChecked ? 'rgba(52,211,153,0.45)' : 'rgba(248,113,113,0.35)'}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                          cursor: 'pointer',
                          textAlign: 'right',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 800, color: isChecked ? '#86efac' : '#fca5a5' }}>
                          {label}
                        </span>
                        {isChecked ? (
                          <CheckCircle2 style={{ width: 15, height: 15, color: '#34d399', flexShrink: 0 }} />
                        ) : (
                          <XCircle style={{ width: 15, height: 15, color: '#f87171', flexShrink: 0 }} />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Supply status + date */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 4 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                      حالة التوريد
                    </label>
                    <select
                      value={state.archives_supply_status}
                      onChange={(e) => update('archives_supply_status', e.target.value)}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 10,
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                        color: '#f1f5f9', fontSize: 13, fontFamily: 'inherit', outline: 'none',
                      }}
                    >
                      {ARCHIVES_SUPPLY_OPTIONS.map((o) => (
                        <option key={o} value={o} style={{ background: '#0f172a' }}>{o}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                      تاريخ التوريد
                    </label>
                    <input
                      type="date"
                      value={state.archives_supply_date}
                      onChange={(e) => update('archives_supply_date', e.target.value)}
                      disabled={state.archives_supply_status === '—'}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 10,
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                        color: state.archives_supply_status === '—' ? '#475569' : '#f1f5f9',
                        fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ════════════════════════════════════════════════════════
          SECTION 3 — RES / سن 6
      ════════════════════════════════════════════════════════ */}
      <div style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${hasResignation ? 'rgba(251,113,133,0.4)' : 'rgba(255,255,255,0.08)'}` }}>
        <SectionHeader
          icon={FileCheck}
          title="شيت الاستقالات (RES.) — استمارة سن 6 والتوريد"
          badge={hasResignation ? 'مسجل في RES' : state.res_ready_for_s6 ? 'جاهز للتوريد' : 'مستمر'}
          badgeColor={hasResignation || state.res_ready_for_s6 ? '#fb7185' : '#34d399'}
          expanded={openSections.res}
          onToggle={() => toggleSection('res')}
        />

        {openSections.res && (
          <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Resignation summary from loaded data */}
            {details.resignation?.found && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.3)', fontSize: 12, color: '#fda4af' }}>
                📋 {details.resignation.message}
                {details.resignation.records?.[0] && (
                  <div style={{ marginTop: 4, fontSize: 11, color: '#94a3b8' }}>
                    تاريخ الاستقالة: {String(details.resignation.records[0].resignation_date ?? '—')} |
                    آخر يوم: {String(details.resignation.records[0].last_working_day ?? '—')} |
                    النوع: {String(details.resignation.records[0].resignation_type ?? '—')}
                  </div>
                )}
              </div>
            )}

            {!details.resignation?.found && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.2)', fontSize: 12, color: '#6ee7b7' }}>
                ✅ الموظف مستمر — لا يوجد سجل استقالة سابق في شيت RES
              </div>
            )}

            {/* S6 calculation summary */}
            {details.s6_calculation && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', fontSize: 12 }}>
                <div style={{ color: '#94a3b8', marginBottom: 4, fontWeight: 700 }}>حساب تاريخ نهاية الاشتراك (سن 6):</div>
                <div style={{ color: details.s6_calculation.calculatedDate ? '#fda4af' : '#64748b', fontFamily: 'monospace', fontWeight: 800 }}>
                  {details.s6_calculation.calculatedDate || (details.s6_calculation.status === 'active' ? 'مستمر بالخدمة — لا تنطبق' : 'يحتاج مراجعة')}
                </div>
                <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{details.s6_calculation.message}</div>
              </div>
            )}

            {/* Ready for S6 & Supplied checkboxes */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                  borderRadius: 12, cursor: 'pointer',
                  background: state.res_ready_for_s6 ? 'rgba(251,113,133,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1.5px solid ${state.res_ready_for_s6 ? 'rgba(251,113,133,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  onClick={() => update('res_ready_for_s6', !state.res_ready_for_s6)}
                  style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                    background: state.res_ready_for_s6 ? '#fb7185' : 'rgba(255,255,255,0.08)',
                    border: `2px solid ${state.res_ready_for_s6 ? '#fb7185' : 'rgba(255,255,255,0.2)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {state.res_ready_for_s6 && <CheckCircle2 style={{ width: 14, height: 14, color: '#fff' }} />}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: state.res_ready_for_s6 ? '#fda4af' : '#cbd5e1' }}>
                    جاهز لتوريد سن 6 (تم التجهيز)
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    تجهيز استمارة سن 6 بناءً على شيت RES
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                  borderRadius: 12, cursor: 'pointer',
                  background: state.res_supplied_s6 ? 'rgba(129,140,248,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1.5px solid ${state.res_supplied_s6 ? 'rgba(129,140,248,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  onClick={() => update('res_supplied_s6', !state.res_supplied_s6)}
                  style={{
                    width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                    background: state.res_supplied_s6 ? '#818cf8' : 'rgba(255,255,255,0.08)',
                    border: `2px solid ${state.res_supplied_s6 ? '#818cf8' : 'rgba(255,255,255,0.2)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {state.res_supplied_s6 && <CheckCircle2 style={{ width: 14, height: 14, color: '#fff' }} />}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: state.res_supplied_s6 ? '#a5b4fc' : '#cbd5e1' }}>
                    تم توريد سن 6 فعلياً
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    تسجيل التوريد وتاريخه في شيت RES
                  </div>
                </div>
              </label>
            </div>

            {/* S6 Supply details fields */}
            {(state.res_ready_for_s6 || state.res_supplied_s6) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 4 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                    نوع توريد تأمينات (RES)
                  </label>
                  <select
                    value={state.res_supply_type}
                    onChange={(e) => update('res_supply_type', e.target.value)}
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 9,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit', outline: 'none',
                    }}
                  >
                    {['يدوي', 'بريد', 'مندوب الشركة', 'مكتب التأمينات'].map((t) => (
                      <option key={t} value={t} style={{ background: '#0f172a' }}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                    تاريخ توريد سن 6
                  </label>
                  <input
                    type="date"
                    value={state.res_supply_date}
                    onChange={(e) => update('res_supply_date', e.target.value)}
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 9,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
          SECTION 4 — New (ورقة الموظفين الجدد)
      ════════════════════════════════════════════════════════ */}
      <div style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${state.add_to_new_sheet ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.08)'}` }}>
        <SectionHeader
          icon={UserPlus}
          title="شيت الموظفين الجدد (New) — إضافة / تحديث"
          badge={state.add_to_new_sheet ? 'مؤشر للإضافة' : undefined}
          badgeColor="#38bdf8"
          expanded={openSections.newEmp}
          onToggle={() => toggleSection('newEmp')}
        />

        {openSections.newEmp && (
          <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Toggle add to New */}
            <label
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                borderRadius: 12, cursor: 'pointer',
                background: state.add_to_new_sheet ? 'rgba(56,189,248,0.12)' : 'rgba(255,255,255,0.03)',
                border: `1.5px solid ${state.add_to_new_sheet ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.1)'}`,
                transition: 'all 0.15s ease',
              }}
            >
              <div
                onClick={() => update('add_to_new_sheet', !state.add_to_new_sheet)}
                style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  background: state.add_to_new_sheet ? '#38bdf8' : 'rgba(255,255,255,0.08)',
                  border: `2px solid ${state.add_to_new_sheet ? '#38bdf8' : 'rgba(255,255,255,0.2)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                {state.add_to_new_sheet && <CheckCircle2 style={{ width: 14, height: 14, color: '#0f172a' }} />}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: state.add_to_new_sheet ? '#7dd3fc' : '#cbd5e1' }}>
                  تأشير لإضافة / تحديث الموظف في شيت New للموظفين الجدد
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  حفظ البيانات مباشرة بالأعمدة الثمانية المعتمدة لورقة New في غاز مصر
                </div>
              </div>
            </label>

            {/* 8 Columns of New */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 700 }}>الاسم</label>
                <input
                  type="text"
                  value={state.new_employee_data.name}
                  onChange={(e) => updateNewEmp('name', e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 700 }}>الرقم القومي</label>
                <input
                  type="text"
                  value={state.new_employee_data.national_id}
                  onChange={(e) => updateNewEmp('national_id', e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 700 }}>الرقم التأميني</label>
                <input
                  type="text"
                  value={state.new_employee_data.insurance_number}
                  onChange={(e) => updateNewEmp('insurance_number', e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 700 }}>الكود</label>
                <input
                  type="text"
                  value={state.new_employee_data.code}
                  onChange={(e) => updateNewEmp('code', e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 700 }}>الوظيفة</label>
                <input
                  type="text"
                  value={state.new_employee_data.job}
                  onChange={(e) => updateNewEmp('job', e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 700 }}>رقم الهاتف</label>
                <input
                  type="text"
                  value={state.new_employee_data.phone}
                  onChange={(e) => updateNewEmp('phone', e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 700 }}>تاريخ الإمضاء</label>
                <input
                  type="date"
                  value={state.new_employee_data.signing_date}
                  onChange={(e) => updateNewEmp('signing_date', e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 700 }}>العنوان</label>
                <input
                  type="text"
                  value={state.new_employee_data.address}
                  onChange={(e) => updateNewEmp('address', e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 9, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#f1f5f9', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
          SECTION 4 — Requests (شيت الريكوستات)
      ════════════════════════════════════════════════════════ */}
      <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
        <SectionHeader
          icon={FileText}
          title="إضافة طلب — شيت Requests"
          badge={details.unifiedProfile?.requests?.length ? `${details.unifiedProfile.requests.length} طلب موجود` : undefined}
          badgeColor="#f59e0b"
          expanded={openSections.requests}
          onToggle={() => toggleSection('requests')}
        />

        {openSections.requests && (
          <div style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Existing requests */}
            {(details.unifiedProfile?.requests?.length ?? 0) > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>الطلبات الموجودة:</div>
                {details.unifiedProfile!.requests!.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '8px 12px', borderRadius: 10,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{r.requestType}</span>
                    <span style={{ color: '#94a3b8' }}>{r.status} — {r.date}</span>
                  </div>
                ))}
              </div>
            )}

            {/* New request form */}
            <div style={{ padding: '12px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f59e0b', marginBottom: 10 }}>➕ إضافة طلب جديد</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 700 }}>نوع الطلب</label>
                  <select
                    value={state.request_type}
                    onChange={(e) => update('request_type', e.target.value)}
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 9,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit', outline: 'none',
                    }}
                  >
                    <option value="" style={{ background: '#0f172a' }}>-- اختر --</option>
                    {REQUEST_TYPES.map((t) => (
                      <option key={t} value={t} style={{ background: '#0f172a' }}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 700 }}>الحالة</label>
                  <select
                    value={state.request_status}
                    onChange={(e) => update('request_status', e.target.value)}
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 9,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit', outline: 'none',
                    }}
                  >
                    {['جاري', 'تم', 'معلق', 'مرفوض'].map((s) => (
                      <option key={s} value={s} style={{ background: '#0f172a' }}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 700 }}>تاريخ الطلب</label>
                  <input
                    type="date"
                    value={state.request_date}
                    onChange={(e) => update('request_date', e.target.value)}
                    style={{
                      width: '100%', padding: '9px 12px', borderRadius: 9,
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4, fontWeight: 700 }}>ملاحظات</label>
                <input
                  type="text"
                  value={state.request_note}
                  onChange={(e) => update('request_note', e.target.value)}
                  placeholder="تفاصيل الطلب..."
                  style={{
                    width: '100%', padding: '9px 12px', borderRadius: 9,
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    color: '#f1f5f9', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
          SECTION 5 — General Note
      ════════════════════════════════════════════════════════ */}
      <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
        <SectionHeader
          icon={Info}
          title="ملاحظة عامة على القائمة"
          expanded={openSections.note}
          onToggle={() => toggleSection('note')}
        />
        {openSections.note && (
          <div style={{ padding: '14px 16px', background: 'rgba(0,0,0,0.2)' }}>
            <textarea
              value={state.checklist_note}
              onChange={(e) => update('checklist_note', e.target.value)}
              placeholder="أي ملاحظة إضافية على إجراءات هذا الموظف..."
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#f1f5f9', fontSize: 13, fontFamily: 'inherit',
                resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════
          SAVE BUTTON
      ════════════════════════════════════════════════════════ */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          padding: '14px 24px', borderRadius: 14,
          background: saved
            ? 'linear-gradient(135deg, #064e3b, #065f46)'
            : saving
              ? 'rgba(99,102,241,0.3)'
              : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
          border: `2px solid ${saved ? '#34d399' : saving ? 'rgba(99,102,241,0.5)' : '#6366f1'}`,
          color: '#ffffff',
          fontSize: 15,
          fontWeight: 900,
          cursor: saving ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s ease',
          boxShadow: saved ? '0 0 20px rgba(52,211,153,0.3)' : saving ? 'none' : '0 0 20px rgba(99,102,241,0.3)',
        }}
      >
        {saving ? (
          <>
            <Loader2 style={{ width: 18, height: 18, animation: 'spin 0.8s linear infinite' }} />
            <span>جاري الحفظ...</span>
          </>
        ) : saved ? (
          <>
            <CheckCircle2 style={{ width: 18, height: 18, color: '#34d399' }} />
            <span>تم الحفظ ✓</span>
          </>
        ) : (
          <>
            <Save style={{ width: 18, height: 18 }} />
            <span>حفظ القائمة وتسجيل الإجراءات</span>
          </>
        )}
      </button>

      {/* Warning: مناقضة without note */}
      {state.insurance_status === 'مناقضة' && !state.discrepancy_note.trim() && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.4)', fontSize: 12, color: '#fbbf24' }}>
          <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0 }} />
          يرجى كتابة نوع / سبب المناقضة قبل الحفظ
        </div>
      )}
    </div>
  );
}
