'use client';

import React, { useState } from 'react';
import {
  Briefcase, FolderCheck, HeartPulse, Landmark, CreditCard,
  ShieldAlert, ShieldCheck, FileText, CheckCircle2, Copy, AlertTriangle,
  User, Clock, Phone, MapPin, FileCheck, Calendar, Sparkles, Building2, HelpCircle
} from 'lucide-react';
import type { EmployeeDetailsResult } from '@/lib/lookupService';

interface Props {
  details: EmployeeDetailsResult;
  onSwitchToTimeline?: () => void;
}

function CopyableBadge({ label, value, mono = false, accent }: { label: string; value?: unknown; mono?: boolean; accent?: string }) {
  const str = value != null ? String(value).trim() : '';
  const [copied, setCopied] = useState(false);

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 14,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        position: 'relative',
        transition: 'all 0.2s ease',
      }}
      className="glass-card-hover"
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span
          className={mono ? 'font-mono-pro' : ''}
          style={{ fontSize: 13, fontWeight: 800, color: str ? (accent || '#ffffff') : '#64748b', wordBreak: 'break-all' }}
        >
          {str || '—'}
        </span>
        {str && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(str);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
            style={{
              background: copied ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)',
              border: 'none',
              borderRadius: 6,
              padding: 4,
              cursor: 'pointer',
              color: copied ? '#34d399' : '#94a3b8',
              display: 'flex',
            }}
            title="نسخ"
          >
            {copied ? <CheckCircle2 style={{ width: 13, height: 13 }} /> : <Copy style={{ width: 13, height: 13 }} />}
          </button>
        )}
      </div>
    </div>
  );
}

export default function UnifiedEmployeeCard({ details, onSwitchToTimeline }: Props) {
  const u = details.unifiedProfile;
  const arch = u?.archives;
  const med = u?.medical;
  const bank = u?.bank;
  const deds = u?.deductions || [];
  const discs = u?.discrepancies || [];
  const reqs = u?.requests || [];
  const workIns = u?.workInsurance;
  const soc = u?.socialInsuranceSheet;

  const completeness = arch?.completenessScore ?? 0;
  const scoreColor = completeness >= 80 ? '#34d399' : completeness >= 50 ? '#f59e0b' : '#fb7185';

  const s1 = details.s1_calculation;
  const s6 = details.s6_calculation;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── 0. Insurance Forms Reference Card (استمارات التأمينات الاجتماعية س1 و س6) ── */}
      <div 
        className="glass-card" 
        style={{ 
          borderRadius: 22, 
          padding: '1.75rem', 
          border: '1.5px solid rgba(56,189,248,0.35)',
          background: 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(8,20,40,0.99) 100%)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {/* Top corner glow */}
        <div style={{ position: 'absolute', top: -30, right: -30, width: 140, height: 140, borderRadius: '50%', background: 'radial-gradient(circle, rgba(56,189,248,0.15) 0%, transparent 70%)', pointerEvents: 'none' }} />

        {/* Header */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FileCheck style={{ width: 24, height: 24, color: '#38bdf8' }} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <h3 style={{ fontSize: 18, fontWeight: 900, color: '#ffffff', margin: 0 }}>
                  بيانات استمارات التأمينات الاجتماعية (استمارة س1 واستمارة س6)
                </h3>
                <span className="badge-brand" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, fontWeight: 800 }}>
                  مرجع التعبئة السريع
                </span>
              </div>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>
                البيانات المعتمدة لنقلها مباشرة إلى نماذج الهيئة القومية للتأمين الاجتماعي مع حساب تواريخ الاشتراك
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 8, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)' }}>
              استمارة س1 (التحاق)
            </span>
            <span style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 8, background: 'rgba(244,63,94,0.15)', color: '#fda4af', border: '1px solid rgba(244,63,94,0.3)' }}>
              استمارة س6 (نهاية خدمة)
            </span>
          </div>
        </div>

        {/* ── Two Hero Calculation Boxes: S1 and S6 ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 20 }}>
          
          {/* S1: تاريخ بداية الاشتراك */}
          <div style={{
            borderRadius: 16,
            padding: '16px 18px',
            background: 'linear-gradient(135deg, rgba(56,189,248,0.08) 0%, rgba(99,102,241,0.08) 100%)',
            border: '1.5px solid rgba(56,189,248,0.35)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  استمارة س1 · تاريخ بداية الاشتراك
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
                  <span className="font-mono-pro" style={{ fontSize: 24, fontWeight: 900, color: s1?.calculatedDate ? '#38bdf8' : s1?.recordedDate ? '#ffffff' : '#fbbf24' }}>
                    {s1?.calculatedDate || s1?.recordedDate || 'يحتاج مراجعة يدوية'}
                  </span>
                  {s1?.calculatedDate && (
                    <span className="badge-emerald" style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, fontWeight: 800 }}>
                      محسوب بالمعادلة ✓
                    </span>
                  )}
                </div>
              </div>
              {(s1?.calculatedDate || s1?.recordedDate) && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(s1.calculatedDate || s1.recordedDate || '');
                  }}
                  style={{
                    background: 'rgba(56,189,248,0.15)',
                    border: '1px solid rgba(56,189,248,0.3)',
                    borderRadius: 8,
                    padding: '6px 10px',
                    cursor: 'pointer',
                    color: '#38bdf8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    fontWeight: 700
                  }}
                  title="نسخ تاريخ بداية الاشتراك"
                >
                  <Copy style={{ width: 13, height: 13 }} />
                  <span>نسخ س1</span>
                </button>
              )}
            </div>

            <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: '8px 12px', border: '1px solid rgba(255,255,255,0.06)', fontSize: 11 }}>
              <div style={{ color: '#cbd5e1', marginBottom: 3 }}>
                <strong>المعادلة: </strong>
                <span className="font-mono-pro" style={{ color: '#38bdf8', fontWeight: 800 }}>
                  {s1?.formula || 'تاريخ البداية = (أيام الشهر - أيام الحضور) + 1'}
                </span>
              </div>
              <div style={{ color: '#94a3b8' }}>{s1?.message}</div>
              {s1?.recordedDate && s1?.calculatedDate && s1.recordedDate !== s1.calculatedDate && (
                <div style={{ marginTop: 4, color: '#fde68a', fontSize: 10 }}>
                  ملاحظة: التاريخ المسجل بالدفاتر: <strong className="font-mono-pro">{s1.recordedDate}</strong>
                </div>
              )}
            </div>
          </div>

          {/* S6: تاريخ نهاية الاشتراك */}
          <div style={{
            borderRadius: 16,
            padding: '16px 18px',
            background: 'linear-gradient(135deg, rgba(244,63,94,0.08) 0%, rgba(245,158,11,0.08) 100%)',
            border: '1.5px solid rgba(244,63,94,0.35)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#fda4af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  استمارة س6 · تاريخ نهاية الاشتراك
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
                  <span className="font-mono-pro" style={{ fontSize: 24, fontWeight: 900, color: s6?.calculatedDate ? '#fda4af' : s6?.status === 'active' ? '#34d399' : '#fbbf24' }}>
                    {s6?.calculatedDate || (s6?.status === 'active' ? 'مستمر بالخدمة' : 'يحتاج مراجعة')}
                  </span>
                  {s6?.status === 'active' ? (
                    <span className="badge-emerald" style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, fontWeight: 800 }}>
                      لا تنطبق س6 حالياً ✓
                    </span>
                  ) : s6?.calculatedDate ? (
                    <span className="badge-rose" style={{ fontSize: 10, padding: '2px 6px', borderRadius: 6, fontWeight: 800 }}>
                      تاريخ إنهاء الخدمة
                    </span>
                  ) : null}
                </div>
              </div>
              {s6?.calculatedDate && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(s6.calculatedDate || '');
                  }}
                  style={{
                    background: 'rgba(244,63,94,0.15)',
                    border: '1px solid rgba(244,63,94,0.3)',
                    borderRadius: 8,
                    padding: '6px 10px',
                    cursor: 'pointer',
                    color: '#fda4af',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    fontWeight: 700
                  }}
                  title="نسخ تاريخ نهاية الاشتراك"
                >
                  <Copy style={{ width: 13, height: 13 }} />
                  <span>نسخ س6</span>
                </button>
              )}
            </div>

            <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 10, padding: '8px 12px', border: '1px solid rgba(255,255,255,0.06)', fontSize: 11 }}>
              <div style={{ color: '#cbd5e1', marginBottom: 3 }}>
                <strong>المعادلة: </strong>
                <span className="font-mono-pro" style={{ color: '#fda4af', fontWeight: 800 }}>
                  {s6?.formula || 'تاريخ النهاية = عدد أيام العمل في آخر شهر'}
                </span>
              </div>
              <div style={{ color: '#94a3b8' }}>{s6?.message}</div>
              {s6?.recordedDate && (
                <div style={{ marginTop: 4, color: '#fde68a', fontSize: 10 }}>
                  تاريخ الاستقالة المسجل: <strong className="font-mono-pro">{s6.recordedDate}</strong> {s6.resignationType && `(${s6.resignationType})`}
                </div>
              )}
            </div>
          </div>

        </div>

        {/* ── All Form 1 & Form 6 Required Fields Grid ── */}
        <div style={{ marginBottom: 12 }}>
          <h4 style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles style={{ width: 14, height: 14, color: '#38bdf8' }} />
            بيانات الموظف اللازمة لتعبئة الاستمارات (قابلة للنسخ المباشر):
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            <CopyableBadge label="اسم الموظف رباعي" value={details.identifiers.employee_name} accent="#ffffff" />
            <CopyableBadge label="الرقم القومي (14 رقم)" value={details.identifiers.national_id} mono accent="#38bdf8" />
            <CopyableBadge label="كود الموظف" value={details.identifiers.employee_code} mono accent="#818cf8" />
            <CopyableBadge label="الرقم التأميني الموحد" value={soc?.insuranceNumber || (details.incomingInsurance.record?.insurance_number as string)} mono accent="#34d399" />
            <CopyableBadge label="الوظيفة الفعلية (بالشركة)" value={u?.jobTitle || (details.incomingInsurance.record?.job_title as string)} />
            <CopyableBadge label="الوظيفة في التأمينات (س1)" value={soc?.insuranceJobTitle || (details.incomingInsurance.record?.insurance_job_title as string) || '—'} accent="#c4b5fd" />
            <CopyableBadge label="الأجر التأميني" value={soc?.insuranceSalary ? `${Number(soc.insuranceSalary).toLocaleString('ar-EG')} ج.م` : '—'} mono accent="#fde047" />
            <CopyableBadge label="الشركة (Account)" value={u?.companyAccount || details.incomingInsurance.company_account} mono accent="#34d399" />
            <CopyableBadge label="تاريخ استلام العمل" value={u?.hireDate || (details.incomingInsurance.record?.hire_date as string) || '—'} mono />
            <CopyableBadge label="المنطقة / الفرع" value={u?.region || (details.incomingInsurance.record?.region as string) || '—'} />
            <CopyableBadge label="الإدارة التابع لها" value={u?.department || (details.incomingInsurance.record?.department as string) || '—'} />
            <CopyableBadge label="الحالة التأمينية" value={soc?.insuranceStatus || (details.incomingInsurance.record?.insurance_status as string) || '—'} accent="#a7f3d0" />
            <CopyableBadge label="رقم الهاتف" value={u?.phoneNumber || '—'} mono />
            <CopyableBadge label="العنوان" value={u?.address || '—'} />
            <CopyableBadge label="طريقة التوريد ومكتب التأمينات" value={soc?.supplyMethod || (details.incomingInsurance.record?.supply_method as string) || '—'} />
            <CopyableBadge label="رقم الـ CRM" value={soc?.crmNumber || (details.incomingInsurance.record?.crm_number as string) || '—'} mono />
            <CopyableBadge label="سبب انتهاء الخدمة (س6)" value={(details.resignation?.records[0]?.resignation_type as string) || (details.incomingInsurance.record?.termination_reason as string) || 'مستمر بالخدمة'} accent="#fda4af" />
            <CopyableBadge label="نوع الاستمارة الموردة" value={(details.resignation?.records[0]?.insurance_supply_type as string) || (details.incomingInsurance.record?.form_type as string) || 'استمارة 1 / 6'} />
          </div>
        </div>

      </div>

      {/* ── 1. Core Employment Card (Database & New) ── */}
      <div className="glass-card" style={{ borderRadius: 20, padding: '1.5rem', border: '1px solid rgba(99,102,241,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Briefcase style={{ width: 20, height: 20, color: '#818cf8' }} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', margin: 0 }}>
                البيانات الوظيفية والأساسية (ورقة Database & New)
              </h3>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                المصدر الأساسي لبيانات التعاقد والموقع الإداري
              </p>
            </div>
          </div>
          <span className="badge-emerald font-mono-pro" style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, fontWeight: 800 }}>
            الحالة: {String(u?.currentStatus || details.incomingInsurance.record?.status || 'Active')}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
          <CopyableBadge label="كود الموظف" value={u?.employeeCode || details.identifiers.employee_code} mono accent="#818cf8" />
          <CopyableBadge label="الرقم القومي" value={u?.nationalId || details.identifiers.national_id} mono accent="#38bdf8" />
          <CopyableBadge label="الوظيفة الفعلية" value={u?.jobTitle || details.incomingInsurance.record?.job_title} accent="#f1f5f9" />
          <CopyableBadge label="الشركة (Account)" value={u?.companyAccount || details.incomingInsurance.company_account} mono accent="#34d399" />
          <CopyableBadge label="المنطقة / الفرع" value={u?.region || details.incomingInsurance.record?.region || '—'} />
          <CopyableBadge label="الإدارة" value={u?.department || details.incomingInsurance.record?.department || '—'} />
          <CopyableBadge label="تاريخ استلام العمل" value={u?.hireDate || details.incomingInsurance.record?.hire_date || '—'} mono />
          <CopyableBadge label="رقم الهاتف" value={u?.phoneNumber || '—'} mono />
          <CopyableBadge label="العنوان" value={u?.address || '—'} />
          <CopyableBadge label="الملاحظات الإدارية" value={u?.notes || 'لا توجد ملاحظات'} />
        </div>
      </div>

      {/* ── 2. Archives & Documents Completeness (Archives) ── */}
      <div className="glass-card" style={{ borderRadius: 20, padding: '1.5rem', border: '1px solid rgba(16,185,129,0.25)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(16,185,129,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FolderCheck style={{ width: 20, height: 20, color: '#34d399' }} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', margin: 0 }}>
                أرشيف المستندات واكتمال مسوغات التعيين (ورقة Archives)
              </h3>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                تدقيق العقد، الفيش، الجيش، المؤهل، ونواقص ملف الموظف
              </p>
            </div>
          </div>

          {arch ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>نسبة اكتمال الملف</div>
                <div className="font-mono-pro" style={{ fontSize: 18, fontWeight: 900, color: scoreColor }}>
                  {completeness}%
                </div>
              </div>
              <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, fontWeight: 800, background: 'rgba(255,255,255,0.06)', color: '#e2e8f0' }}>
                {arch.availableCount} موجود · {arch.missingCount} ناقص
              </span>
            </div>
          ) : (
            <span className="badge-slate" style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8 }}>
              بانتظار استيراد ورقة Archives
            </span>
          )}
        </div>

        {/* Progress Bar */}
        {arch && (
          <div style={{ width: '100%', height: 8, background: 'rgba(255,255,255,0.06)', borderRadius: 9999, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ width: `${completeness}%`, height: '100%', background: scoreColor, borderRadius: 9999, transition: 'width 0.5s ease' }} />
          </div>
        )}

        {/* Grid of 10 Required Documents */}
        {arch ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
            {[
              { label: 'العقد المبرم', val: arch.contract },
              { label: 'صورة البطاقة', val: arch.idCard },
              { label: 'المؤهل الدراسي', val: arch.qualification },
              { label: 'الموقف من التجنيد', val: arch.military },
              { label: 'شهادة الميلاد', val: arch.birthCertificate },
              { label: 'كعب العمل', val: arch.workPermit },
              { label: 'الفيش الجنائي', val: arch.criminalRecord },
              { label: 'الصور الشخصية', val: arch.photos },
              { label: 'شهادة قياس المهارة', val: arch.skillTest },
              { label: 'المسح الضوئي (Scan)', val: arch.scan },
            ].map((doc, idx) => {
              const s = String(doc.val || '').trim().toLowerCase();
              const isPositive = s.includes('يوجد') || s.includes('اصل') || s.includes('أصل') || s.includes('صوره') || s.includes('صورة') || s === 'scan';
              return (
                <div
                  key={idx}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    background: isPositive ? 'rgba(16,185,129,0.06)' : 'rgba(244,63,94,0.06)',
                    border: `1px solid ${isPositive ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.3)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1' }}>{doc.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: isPositive ? '#6ee7b7' : '#fda4af', marginTop: 2 }}>
                      {doc.val || 'غير متوفر'}
                    </div>
                  </div>
                  <span style={{ fontSize: 16 }}>{isPositive ? '✓' : '✗'}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: 13, background: 'rgba(255,255,255,0.02)', borderRadius: 12 }}>
            لم يتم رفع ورقة Archives لهذا الموظف بعد. عند رفع الورقة عبر شاشة «الاستيراد الذكي» ستظهر مسوغات تعيين الموظف هنا تلقائياً.
          </div>
        )}
      </div>

      {/* ── 3. Medical & 111 (Medical) ── */}
      <div className="glass-card" style={{ borderRadius: 20, padding: '1.5rem', border: '1px solid rgba(236,72,153,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(236,72,153,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <HeartPulse style={{ width: 20, height: 20, color: '#f472b6' }} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', margin: 0 }}>
                الكشف الطبي ونماذج 111 والبطاقات العلاجية (ورقة Medical)
              </h3>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                حالة نموذج 111 والتأمين الطبي وإصدار وتجديد البطاقات العلاجية
              </p>
            </div>
          </div>
          {med?.exam111Status && (
            <span style={{
              fontSize: 12, padding: '4px 12px', borderRadius: 8, fontWeight: 800,
              background: med.exam111Status.includes('تم') ? 'rgba(16,185,129,0.18)' : 'rgba(244,63,94,0.18)',
              color: med.exam111Status.includes('تم') ? '#34d399' : '#fda4af',
            }}>
              نموذج 111: {med.exam111Status}
            </span>
          )}
        </div>

        {med ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            <CopyableBadge label="نموذج 111" value={med.exam111Status} accent={med.exam111Status?.includes('تم') ? '#34d399' : '#fb7185'} />
            <CopyableBadge label="البطاقة العلاجية" value={med.medicalCardStatus} accent="#38bdf8" />
            <CopyableBadge label="تاريخ الإصدار" value={med.issueDate} mono />
            <CopyableBadge label="تاريخ الاستلام" value={med.receiveDate} mono />
            <CopyableBadge label="التجديد الأول" value={med.renewal1} />
            <CopyableBadge label="التجديد الثاني" value={med.renewal2} />
            <CopyableBadge label="برايفت ميديكال" value={med.privateMedical} />
            <CopyableBadge label="الدفعة" value={med.batch} />
            <CopyableBadge label="تاريخ الإرسال" value={med.sendDate} mono />
          </div>
        ) : (
          <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: 13, background: 'rgba(255,255,255,0.02)', borderRadius: 12 }}>
            لا توجد بيانات كشف طبي مسجلة في ورقة Medical لهذا الموظف بعد.
          </div>
        )}
      </div>

      {/* ── 4. Bank Account & Legal Deductions ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
        {/* Bank Account */}
        <div className="glass-card" style={{ borderRadius: 20, padding: '1.5rem', border: '1px solid rgba(56,189,248,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(56,189,248,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Landmark style={{ width: 20, height: 20, color: '#38bdf8' }} />
            </div>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', margin: 0 }}>
                الحساب البنكي وتحويل الرواتب (ورقة Bank ACC.)
              </h3>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                مصرف تحويل الراتب المعتمد
              </p>
            </div>
          </div>

          {bank ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ padding: '12px 14px', borderRadius: 12, background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>البنك المعتمد للتحويل</div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: '#38bdf8' }}>{bank.primaryBank}</div>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700 }}>رقم الحساب / الكود</div>
                  <div className="font-mono-pro" style={{ fontSize: 15, fontWeight: 900, color: '#ffffff' }}>{bank.accountNumber}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>SAIB: </span>
                  <strong className="font-mono-pro" style={{ fontSize: 12, color: bank.saib && bank.saib !== '0' ? '#34d399' : '#64748b' }}>{bank.saib || '0'}</strong>
                </div>
                <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>CIB: </span>
                  <strong className="font-mono-pro" style={{ fontSize: 12, color: bank.cib && bank.cib !== '0' ? '#34d399' : '#64748b' }}>{bank.cib || '0'}</strong>
                </div>
                <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>ADIB: </span>
                  <strong className="font-mono-pro" style={{ fontSize: 12, color: bank.adib && bank.adib !== '0' ? '#34d399' : '#64748b' }}>{bank.adib || '0'}</strong>
                </div>
                <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>DOPAY: </span>
                  <strong className="font-mono-pro" style={{ fontSize: 12, color: bank.dopay && bank.dopay !== '0' ? '#34d399' : '#64748b' }}>{bank.dopay || '0'}</strong>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: 12, background: 'rgba(255,255,255,0.02)', borderRadius: 12 }}>
              لم يتم تسجيل بيانات حساب بنكي للموظف في شيت Bank ACC.
            </div>
          )}
        </div>

        {/* Deductions Card */}
        <div className="glass-card" style={{ borderRadius: 20, padding: '1.5rem', border: '1px solid rgba(244,63,94,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(244,63,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CreditCard style={{ width: 20, height: 20, color: '#fb7185' }} />
              </div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', margin: 0 }}>
                  استقطاعات النفقات والأحكام (ورقة Deductions)
                </h3>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                  الاستقطاعات القضائية وأسماء المستفيدين
                </p>
              </div>
            </div>
            <span style={{
              fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 800,
              background: deds.length > 0 ? 'rgba(244,63,94,0.2)' : 'rgba(16,185,129,0.15)',
              color: deds.length > 0 ? '#fda4af' : '#6ee7b7',
            }}>
              {deds.length > 0 ? `${deds.length} استقطاع مسجل ⚠️` : 'لا توجد نفقات ✓'}
            </span>
          </div>

          {deds.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {deds.map((d, i) => (
                <div key={i} style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#fda4af' }}>{d.type || 'نفقة شرعية'}</div>
                    <div style={{ fontSize: 11, color: '#e2e8f0', marginTop: 2 }}>
                      المستفيد: <strong style={{ color: '#ffffff' }}>{d.beneficiary || 'غير محدد'}</strong>
                    </div>
                    {d.department && <div style={{ fontSize: 10, color: '#94a3b8' }}>الإدارة: {d.department}</div>}
                  </div>
                  <div className="font-mono-pro" style={{ fontSize: 16, fontWeight: 900, color: '#fda4af' }}>
                    {Number(d.amount).toLocaleString('ar-EG')} ج.م
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center', background: 'rgba(16,185,129,0.05)', borderRadius: 12, border: '1px solid rgba(16,185,129,0.15)' }}>
              <CheckCircle2 style={{ width: 28, height: 28, color: '#34d399', margin: '0 auto 8px' }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: '#6ee7b7' }}>لا توجد استقطاعات أو أحكام مسجلة للموظف</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>لم يرد اسم الموظف في شيت الاستقطاعات والنفقات.</div>
            </div>
          )}
        </div>
      </div>

      {/* ── 5. Discrepancies & Compliance Alerts (شيت المنقاضات) ── */}
      <div className="glass-card" style={{ borderRadius: 20, padding: '1.5rem', border: `1px solid ${discs.length > 0 ? 'rgba(245,158,11,0.35)' : 'rgba(16,185,129,0.25)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: discs.length > 0 ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldAlert style={{ width: 20, height: 20, color: discs.length > 0 ? '#fbbf24' : '#34d399' }} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', margin: 0 }}>
                تدقيق المناقضات والتنبيهات الرقابية (ورقة شيت المنقاضات)
              </h3>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                كارت النقابة، مؤمن خارج المؤسسة، رخص القيادة والملاحظات
              </p>
            </div>
          </div>
          <span style={{
            fontSize: 12, padding: '4px 12px', borderRadius: 8, fontWeight: 800,
            background: discs.length > 0 ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.15)',
            color: discs.length > 0 ? '#fde68a' : '#6ee7b7',
          }}>
            {discs.length > 0 ? `${discs.length} تنبيه مسجل ⚠️` : 'سجل سليم تماماً ✓'}
          </span>
        </div>

        {discs.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {discs.map((dc, i) => (
              <div key={i} style={{ padding: '12px 16px', borderRadius: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#fde68a' }}>{dc.note}</div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#cbd5e1', marginTop: 4 }}>
                    {dc.actualSite && <span>الموقع: <strong>{dc.actualSite}</strong></span>}
                    {dc.region && <span>المنطقة: <strong>{dc.region}</strong></span>}
                    {dc.hireDate && <span>تاريخ العمل: <strong className="font-mono-pro">{dc.hireDate}</strong></span>}
                  </div>
                </div>
                <span className="badge-amber" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 800 }}>
                  يحتاج تسوية
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '20px 16px', textAlign: 'center', background: 'rgba(16,185,129,0.05)', borderRadius: 12, border: '1px solid rgba(16,185,129,0.15)' }}>
            <CheckCircle2 style={{ width: 28, height: 28, color: '#34d399', margin: '0 auto 8px' }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: '#6ee7b7' }}>تم فحص شيت المناقضات — لا توجد أي تعارضات أو ملاحظات رقابية نشطة</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>كارت النقابة والرخص والتأمين سليم ولا يحتاج لتسويات.</div>
          </div>
        )}
      </div>

      {/* ── 6. Social Insurance & Work Attendance ── */}
      <div className="glass-card" style={{ borderRadius: 20, padding: '1.5rem', border: '1px solid rgba(139,92,246,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(139,92,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck style={{ width: 20, height: 20, color: '#a78bfa' }} />
            </div>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', margin: 0 }}>
                بيانات التأمينات وتوريد الاستمارات (Social.insurance & شغل تأمينات & أرقام وارد التأمين)
              </h3>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                الأجر التأميني والشامل وحركة الاشتراك وساعات العمل للشهور الأخيرة
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
          <CopyableBadge label="الرقم التأميني" value={soc?.insuranceNumber || details.incomingInsurance.record?.insurance_number} mono accent="#a78bfa" />
          <CopyableBadge label="الحالة التأمينية" value={soc?.insuranceStatus || details.incomingInsurance.record?.insurance_status} accent="#34d399" />
          <CopyableBadge label="الأجر التأميني" value={soc?.insuranceSalary ? `${Number(soc.insuranceSalary).toLocaleString('ar-EG')} ج.م` : '—'} mono accent="#38bdf8" />
          <CopyableBadge label="الوظيفة في التأمينات" value={soc?.insuranceJobTitle || details.incomingInsurance.record?.insurance_job_title} />
          <CopyableBadge label="تاريخ بداية الاشتراك" value={soc?.subscriptionStartDate || details.incomingInsurance.record?.subscription_start_date} mono />
          <CopyableBadge label="طريقة التوريد ومكتب التأمين" value={soc?.supplyMethod || details.incomingInsurance.record?.supply_method || '—'} />
          <CopyableBadge label="رقم الـ CRM" value={soc?.crmNumber || details.incomingInsurance.record?.crm_number || '—'} mono />
          {workIns && (
            <>
              <CopyableBadge label="الأجر الشامل (شغل تأمينات)" value={workIns.totalSalary ? `${Number(workIns.totalSalary).toLocaleString('ar-EG')} ج.م` : '—'} mono accent="#fde047" />
              <CopyableBadge label="أيام عمل شهور (5 - 6 - 7)" value={`ش5: ${workIns.month5} | ش6: ${workIns.month6} | ش7: ${workIns.month7}`} mono accent="#6ee7b7" />
            </>
          )}
        </div>
      </div>

      {/* ── 7. Employee Requests Log (Requests) ── */}
      {reqs.length > 0 && (
        <div className="glass-card" style={{ borderRadius: 20, padding: '1.5rem', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <FileText style={{ width: 18, height: 18, color: '#818cf8' }} />
            <h3 style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', margin: 0 }}>
              سجل طلبات الموظف (ورقة Requests)
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {reqs.map((rq, idx) => (
              <div key={idx} style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#ffffff' }}>{rq.requestType}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>المستلم: {rq.recipient || '—'} {rq.notes && `· ${rq.notes}`}</div>
                </div>
                <div style={{ textAlign: 'left' }}>
                  <span className="badge-emerald" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6 }}>{rq.status}</span>
                  {rq.date && <div className="font-mono-pro" style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>{rq.date}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
