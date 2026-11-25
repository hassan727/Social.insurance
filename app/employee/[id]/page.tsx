'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  User, Building2, Shield, Phone, MapPin, Calendar, Briefcase,
  FileText, AlertTriangle, CheckCircle2, Clock, ChevronLeft,
  Database, Archive, Heart, CreditCard, FileSpreadsheet,
  BarChart3, Activity, Layers, Copy, ExternalLink, RefreshCw,
  XCircle, Info, ChevronDown, ChevronUp, Hash,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface EmployeeMaster {
  id: string;
  company_account: string;
  employee_code: string | null;
  national_id: string | null;
  employee_name: string;
  current_status: string | null;
  current_job_title: string | null;
  current_region: string | null;
  current_department: string | null;
  insurance_number: string | null;
  insurance_status: string | null;
  insurance_salary: number | null;
  insurance_job_title: string | null;
  insurance_start_date: string | null;
  hire_date: string | null;
  resignation_date: string | null;
  last_working_day: string | null;
  phone_number: string | null;
  address: string | null;
  consolidated_data: Record<string, unknown>;
  data_completeness_score: number | null;
  has_duplicate_risk: boolean | null;
  last_updated_at: string;
  completeness_score: number;
}

interface SheetEntry {
  display_name: string;
  description: string | null;
  row_data: Record<string, unknown>;
  last_updated: string;
}

interface HistoryEntry {
  id: string;
  change_type: string;
  changed_fields: string[] | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  change_reason: string | null;
  notes: string | null;
  created_at: string;
}

interface Discrepancy {
  id: string;
  discrepancy_type: string;
  severity: string;
  source_a: string | null;
  source_b: string | null;
  field_name: string | null;
  value_a: string | null;
  value_b: string | null;
  description: string;
  first_detected_at: string;
}

interface EmployeeProfileData {
  employee: EmployeeMaster;
  sheet_data: Record<string, SheetEntry>;
  sources_found: string[];
  history: HistoryEntry[];
  open_discrepancies: Discrepancy[];
  meta: {
    total_sheets_with_data: number;
    total_history_entries: number;
    total_open_discrepancies: number;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function CopyBtn({ value }: { value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      title="نسخ"
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 4, color: copied ? '#34d399' : '#475569', display: 'inline-flex', alignItems: 'center' }}
    >
      {copied ? <CheckCircle2 style={{ width: 12, height: 12 }} /> : <Copy style={{ width: 12, height: 12 }} />}
    </button>
  );
}

function InfoRow({ label, value, mono = false, accent, icon }: {
  label: string; value?: string | number | null; mono?: boolean; accent?: string; icon?: React.ReactNode;
}) {
  const str = value != null ? String(value) : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {icon}
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 13, fontWeight: 700,
          color: str ? (accent ?? '#e2e8f0') : '#334155',
          fontFamily: mono ? "'JetBrains Mono', monospace" : 'inherit',
        }}>
          {str || '—'}
        </span>
        {str && <CopyBtn value={str} />}
      </div>
    </div>
  );
}

function SectionCard({ title, icon, children, color = '#6366f1', badge }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; color?: string; badge?: string | number;
}) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${color}22`, borderRadius: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${color}15`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>{icon}</div>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0' }}>{title}</span>
        {badge != null && badge !== 0 && (
          <span style={{ marginRight: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: `${color}20`, color }}>{badge}</span>
        )}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span style={{ color: '#475569', fontSize: 12 }}>—</span>;
  const lower = status.toLowerCase();
  const isActive = lower.includes('active') || lower.includes('نشط') || lower.includes('مستمر');
  const isResigned = lower.includes('resign') || lower.includes('استق') || lower.includes('منتهي');
  const isNew = lower.includes('new') || lower.includes('جديد');
  const color = isActive ? '#34d399' : isResigned ? '#fb7185' : isNew ? '#f59e0b' : '#94a3b8';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 999, background: `${color}18`, border: `1px solid ${color}40`, fontSize: 12, fontWeight: 700, color }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {status}
    </span>
  );
}

function CompletenessBar({ score }: { score: number }) {
  const color = score >= 80 ? '#34d399' : score >= 50 ? '#f59e0b' : '#fb7185';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)' }}>
        <div style={{ width: `${score}%`, height: '100%', borderRadius: 999, background: color, transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 36 }}>{score}%</span>
    </div>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#fb7185',
  warning: '#f59e0b',
  info: '#94a3b8',
};

const SHEET_ICONS: Record<string, React.ReactNode> = {
  Database: <Database style={{ width: 13, height: 13 }} />,
  Archives: <Archive style={{ width: 13, height: 13 }} />,
  Medical: <Heart style={{ width: 13, height: 13 }} />,
  'Bank ACC': <CreditCard style={{ width: 13, height: 13 }} />,
  'Social Insurance': <Shield style={{ width: 13, height: 13 }} />,
  'Incoming Insurance': <Shield style={{ width: 13, height: 13 }} />,
  RES: <FileText style={{ width: 13, height: 13 }} />,
  New: <User style={{ width: 13, height: 13 }} />,
  HR: <FileSpreadsheet style={{ width: 13, height: 13 }} />,
  Deductions: <BarChart3 style={{ width: 13, height: 13 }} />,
  Requests: <Activity style={{ width: 13, height: 13 }} />,
};

// ═══════════════════════════════════════════════════════════════════════════
// SHEET DATA VIEWER (expandable raw data panel)
// ═══════════════════════════════════════════════════════════════════════════

function SheetDataPanel({ sheetName, entry }: { sheetName: string; entry: SheetEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', textAlign: 'right' }}
      >
        <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#818cf8' }}>
          {SHEET_ICONS[sheetName] ?? <Layers style={{ width: 13, height: 13 }} />}
        </div>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{entry.display_name}</div>
          <div style={{ fontSize: 10, color: '#475569' }}>{sheetName} · {Object.keys(entry.row_data).length} حقل</div>
        </div>
        <div style={{ color: '#22c55e', fontSize: 10, fontWeight: 700 }}>✅ بيانات موجودة</div>
        {expanded ? <ChevronUp style={{ width: 14, height: 14 }} /> : <ChevronDown style={{ width: 14, height: 14 }} />}
      </button>

      {expanded && (
        <div style={{ padding: '0 14px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {Object.entries(entry.row_data)
            .filter(([, v]) => v != null && v !== '' && !['id', 'sheet_id', 'employee_id', 'import_id'].includes(''))
            .map(([key, val]) => (
              <InfoRow key={key} label={key} value={String(val)} />
            ))
          }
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function EmployeeProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<EmployeeProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'sheets' | 'history' | 'discrepancies'>('overview');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/employee/${id}`);
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل التحميل');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: '80px 20px' }}>
        <div style={{ width: 48, height: 48, border: '3px solid rgba(99,102,241,0.3)', borderTop: '3px solid #6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <div style={{ color: '#475569', fontSize: 14, fontWeight: 600 }}>جاري تحميل ملف الموظف...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: '80px 20px' }}>
        <XCircle style={{ width: 48, height: 48, color: '#fb7185' }} />
        <div style={{ color: '#fb7185', fontSize: 16, fontWeight: 700 }}>{error ?? 'الموظف غير موجود'}</div>
        <Link href="/employees" style={{ color: '#6366f1', fontSize: 13, textDecoration: 'underline' }}>← العودة لقائمة الموظفين</Link>
      </div>
    );
  }

  const { employee: emp, sheet_data, sources_found, history, open_discrepancies, meta } = data;
  // Cross-source field conflicts recorded by the consolidation merge: the
  // scalar is withheld (never auto-selected); each competing value is shown
  // with its source. Conflicting scalar fields render as "محتاج مراجعة"
  // instead of a blank that would read as settled/empty.
  const fieldConflicts = ((emp.consolidated_data as Record<string, unknown> | null)?.field_conflicts ?? {}) as Record<string, { source: string; value: unknown; at: string }[]>;
  // Dedupe: raw alias keys and their canonical key describe the same fact.
  const ALIAS_TO_CANONICAL: Record<string, string> = {
    'الكود': 'employee_code', 'الرقم القومى': 'national_id',
    'job_title': 'current_job_title', 'الوظيفه': 'current_job_title',
    'region': 'current_region', 'المنطقه': 'current_region',
    'department': 'current_department', 'الاداره': 'current_department',
    'status': 'current_status', 'الحاله': 'current_status',
    'الرقم التامينى': 'insurance_number', 'الرقم التاميني': 'insurance_number',
    'الرقم التأميني': 'insurance_number', 'الرقم التأمينى': 'insurance_number',
    'الحاله التامينيه': 'insurance_status', 'الحالة التأمينية': 'insurance_status',
    'الاجر التامينى': 'insurance_salary',
    'الوظيفه في التامينات': 'insurance_job_title',
    'رقم الهاتف': 'phone_number', 'العنوان': 'address',
    'تاريخ استلام العمل': 'hire_date',
    'subscription_start_date': 'insurance_start_date', 'تاريخ بدايه الاشتراك': 'insurance_start_date',
    'resignation_date': 'resignation_date', 'تاريخ الاستقاله': 'resignation_date',
    'last_working_day': 'last_working_day', 'اخر يوم عمل': 'last_working_day',
  };
  const conflictFieldSet = new Set(Object.keys(fieldConflicts).filter((k) => {
    if (!Array.isArray(fieldConflicts[k]) || fieldConflicts[k].length < 2) return false;
    const canonical = ALIAS_TO_CANONICAL[k];
    if (canonical && Array.isArray(fieldConflicts[canonical]) && fieldConflicts[canonical].length >= 2) return false;
    return true;
  }));
  const FIELD_LABELS: Record<string, string> = {
    employee_code: 'كود الموظف', national_id: 'الرقم القومي',
    current_job_title: 'الوظيفة', current_region: 'المنطقة',
    current_department: 'الإدارة', current_status: 'حالة العمل',
    insurance_number: 'الرقم التأميني', insurance_status: 'الحالة التأمينية',
    insurance_salary: 'الأجر التأميني', insurance_job_title: 'الوظيفة في التأمينات',
    insurance_start_date: 'تاريخ بداية الاشتراك', phone_number: 'رقم الهاتف',
    address: 'العنوان', hire_date: 'تاريخ استلام العمل',
    resignation_date: 'تاريخ الاستقالة', last_working_day: 'آخر يوم عمل',
  };
  const cv = (field: string, value: string | number | null | undefined) =>
    conflictFieldSet.has(field) ? '⚠ محتاج مراجعة' : (value ?? null);
  const ca = (field: string, accent?: string) =>
    conflictFieldSet.has(field) ? '#fbbf24' : accent;
  const criticalCount = open_discrepancies.filter((d) => d.severity === 'critical').length;

  const ALL_SHEETS = ['Database', 'Archives', 'Social Insurance', 'Incoming Insurance', 'Medical', 'Bank ACC', 'RES', 'New', 'HR Letter', 'Deductions', 'Requests', 'شغل تأمينات', 'أرقام وارد التأمين'];

  const TABS = [
    { id: 'overview', label: 'نظرة عامة', icon: <User style={{ width: 13, height: 13 }} /> },
    { id: 'sheets', label: `بيانات الشيتات`, badge: meta.total_sheets_with_data, icon: <Layers style={{ width: 13, height: 13 }} /> },
    { id: 'history', label: 'سجل التغييرات', badge: meta.total_history_entries, icon: <Clock style={{ width: 13, height: 13 }} /> },
    { id: 'discrepancies', label: 'التعارضات', badge: meta.total_open_discrepancies, badgeColor: criticalCount > 0 ? '#fb7185' : '#f59e0b', icon: <AlertTriangle style={{ width: 13, height: 13 }} /> },
  ] as const;

  return (
    <div style={{ padding: '24px 20px' }}>
      {/* ── Back link ── */}
      <Link
          href="/employees"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#475569', fontSize: 12, fontWeight: 600, textDecoration: 'none', marginBottom: 20, transition: 'color 0.2s' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#818cf8'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#475569'; }}
        >
          <ChevronLeft style={{ width: 14, height: 14 }} />
          قائمة الموظفين
        </Link>

        {/* ── Header Card ── */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.08) 100%)',
          border: '1px solid rgba(99,102,241,0.25)',
          borderRadius: 20,
          padding: 24,
          marginBottom: 24,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Glow */}
          <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)', pointerEvents: 'none' }} />

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
            {/* Avatar */}
            <div style={{
              width: 64, height: 64, borderRadius: 18,
              background: 'linear-gradient(135deg, #4338ca, #6366f1, #7c3aed)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, fontWeight: 900, color: '#fff', flexShrink: 0,
              boxShadow: '0 8px 32px rgba(99,102,241,0.4)',
            }}>
              {emp.employee_name?.charAt(0) ?? '?'}
            </div>

            {/* Name & identifiers */}
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <h1 style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9', margin: 0 }}>
                  {emp.employee_name}
                </h1>
                <StatusBadge status={emp.current_status} />
                {emp.has_duplicate_risk && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'rgba(251,113,133,0.15)', border: '1px solid rgba(251,113,133,0.3)', color: '#fb7185' }}>
                    ⚠️ خطر تكرار
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#94a3b8' }}>
                  <Hash style={{ width: 12, height: 12 }} />
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#818cf8' }}>{emp.employee_code ?? '—'}</span>
                  <CopyBtn value={emp.employee_code} />
                </span>
                <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>
                  {emp.company_account === 'E.G' ? '🏢 E.G' : emp.company_account === 'm.g' ? '🏗️ m.g' : emp.company_account}
                </span>
                {emp.current_job_title && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#94a3b8' }}>
                    <Briefcase style={{ width: 11, height: 11 }} />
                    {emp.current_job_title}
                  </span>
                )}
                {emp.current_department && (
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>| {emp.current_department}</span>
                )}
              </div>
            </div>

            {/* Completeness + actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 180 }}>
              <div>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, marginBottom: 4 }}>اكتمال البيانات</div>
                <CompletenessBar score={emp.completeness_score} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={load}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >
                  <RefreshCw style={{ width: 11, height: 11 }} />
                  تحديث
                </button>
                {criticalCount > 0 && (
                  <button
                    onClick={() => setActiveTab('discrepancies')}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, background: 'rgba(251,113,133,0.12)', border: '1px solid rgba(251,113,133,0.3)', color: '#fb7185', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    <AlertTriangle style={{ width: 11, height: 11 }} />
                    {criticalCount} حرج
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Source pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>
            {ALL_SHEETS.map((sheet) => {
              const found = sources_found.includes(sheet);
              return (
                <span key={sheet} style={{
                  fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                  background: found ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${found ? 'rgba(52,211,153,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  color: found ? '#34d399' : '#334155',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {found ? '✅' : '⬜'} {sheet}
                </span>
              );
            })}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: 0 }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '10px 16px', borderRadius: '10px 10px 0 0',
                  background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
                  border: isActive ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
                  borderBottom: isActive ? '1px solid #080d1a' : 'transparent',
                  marginBottom: isActive ? -1 : 0,
                  color: isActive ? '#818cf8' : '#475569',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {tab.icon}
                {tab.label}
                {(tab as { badge?: number; badgeColor?: string }).badge != null && (tab as { badge?: number }).badge !== 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                    background: `${(tab as { badgeColor?: string }).badgeColor ?? '#6366f1'}20`,
                    color: (tab as { badgeColor?: string }).badgeColor ?? '#818cf8',
                  }}>
                    {(tab as { badge?: number }).badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            TAB: OVERVIEW
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>

            {/* Cross-source field conflicts — withheld scalars, sources shown */}
            {conflictFieldSet.size > 0 && (
              <SectionCard title="حقول تحتاج مراجعة (تعارض بين المصادر)" icon={<AlertTriangle style={{ width: 14, height: 14 }} />} color="#fbbf24" badge={conflictFieldSet.size}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 2px' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>لم تُختر قيمة تلقائيًا لهذه الحقول — تظهر كل قيمة مع مصدرها حتى تُحسم:</div>
                  {Array.from(conflictFieldSet).map((field) => (
                    <div key={field} style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 10, padding: '8px 12px' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#fbbf24', marginBottom: 4 }}>{FIELD_LABELS[field] || field}</div>
                      {fieldConflicts[field].map((e, i) => (
                        <div key={i} style={{ fontSize: 12, color: '#fde68a', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700 }}>{String(e.value)}</span>
                          <span style={{ color: '#94a3b8' }}>(مصدر: {e.source})</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Identity */}
            <SectionCard title="بيانات الهوية" icon={<User style={{ width: 14, height: 14 }} />} color="#6366f1">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <InfoRow label="الرقم القومي" value={cv('national_id', emp.national_id)} mono icon={<Hash style={{ width: 9, height: 9 }} />} accent={ca('national_id', '#818cf8')} />
                <InfoRow label="كود الموظف" value={cv('employee_code', emp.employee_code)} mono accent={ca('employee_code', '#818cf8')} />
                <InfoRow label="الحساب" value={emp.company_account} />
                <InfoRow label="الحالة" value={cv('current_status', emp.current_status)} accent={ca('current_status')} />
              </div>
            </SectionCard>

            {/* Employment */}
            <SectionCard title="البيانات الوظيفية" icon={<Briefcase style={{ width: 14, height: 14 }} />} color="#38bdf8">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <InfoRow label="الوظيفة" value={cv('current_job_title', emp.current_job_title)} accent={ca('current_job_title')} />
                <InfoRow label="الإدارة" value={cv('current_department', emp.current_department)} accent={ca('current_department')} />
                <InfoRow label="المنطقة" value={cv('current_region', emp.current_region)} accent={ca('current_region')} />
                <InfoRow label="تاريخ الاستلام" value={cv('hire_date', emp.hire_date)} icon={<Calendar style={{ width: 9, height: 9 }} />} accent={ca('hire_date', '#38bdf8')} />
                {emp.resignation_date && (
                  <InfoRow label="تاريخ الاستقالة" value={emp.resignation_date} accent="#fb7185" />
                )}
                {emp.last_working_day && (
                  <InfoRow label="آخر يوم عمل" value={emp.last_working_day} accent="#fb7185" />
                )}
              </div>
            </SectionCard>

            {/* Insurance */}
            <SectionCard title="بيانات التأمينات" icon={<Shield style={{ width: 14, height: 14 }} />} color="#34d399">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <InfoRow label="الرقم التأميني" value={cv('insurance_number', emp.insurance_number)} mono accent={ca('insurance_number', '#34d399')} />
                <InfoRow label="الحالة التأمينية" value={cv('insurance_status', emp.insurance_status)} accent={ca('insurance_status', '#34d399')} />
                <InfoRow label="الأجر التأميني" value={cv('insurance_salary', emp.insurance_salary != null ? `${emp.insurance_salary.toLocaleString('ar-EG')} ج.م` : null)} accent={ca('insurance_salary', '#a3e635')} />
                <InfoRow label="الوظيفة في التأمينات" value={cv('insurance_job_title', emp.insurance_job_title)} accent={ca('insurance_job_title')} />
                <InfoRow label="تاريخ بداية الاشتراك" value={cv('insurance_start_date', emp.insurance_start_date)} icon={<Calendar style={{ width: 9, height: 9 }} />} accent={ca('insurance_start_date')} />
              </div>
            </SectionCard>

            {/* Contact */}
            <SectionCard title="معلومات الاتصال" icon={<Phone style={{ width: 14, height: 14 }} />} color="#f59e0b">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                <InfoRow label="رقم الهاتف" value={cv('phone_number', emp.phone_number)} mono icon={<Phone style={{ width: 9, height: 9 }} />} accent={ca('phone_number', '#f59e0b')} />
                <InfoRow label="العنوان" value={cv('address', emp.address)} icon={<MapPin style={{ width: 9, height: 9 }} />} accent={ca('address')} />
              </div>
            </SectionCard>

          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: SHEETS DATA
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'sheets' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#475569', marginBottom: 4 }}>
              تم العثور على بيانات في {meta.total_sheets_with_data} مصدر من أصل {ALL_SHEETS.length} مصدر متوقع
            </div>
            {Object.entries(sheet_data).map(([sheetName, entry]) => (
              <SheetDataPanel key={sheetName} sheetName={sheetName} entry={entry} />
            ))}
            {Object.keys(sheet_data).length === 0 && (
              <div style={{ textAlign: 'center', padding: 60, color: '#334155' }}>
                <Database style={{ width: 40, height: 40, opacity: 0.3, margin: '0 auto 12px' }} />
                <div style={{ fontSize: 14 }}>لم يتم استيراد بيانات هذا الموظف من أي شيت بعد</div>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: HISTORY
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#334155' }}>
                <Clock style={{ width: 40, height: 40, opacity: 0.3, margin: '0 auto 12px' }} />
                <div style={{ fontSize: 14 }}>لا يوجد سجل تغييرات حتى الآن</div>
              </div>
            ) : history.map((entry) => (
              <div key={entry.id} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '12px 16px', display: 'flex', gap: 14 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Clock style={{ width: 14, height: 14, color: '#818cf8' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#818cf8' }}>{entry.change_type}</span>
                    {(entry.changed_fields || []).map((f) => (
                      <span key={f} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>{f}</span>
                    ))}
                    <span style={{ marginRight: 'auto', fontSize: 10, color: '#334155' }}>{new Date(entry.created_at).toLocaleString('ar-EG')}</span>
                  </div>
                  {entry.notes && <div style={{ fontSize: 12, color: '#64748b' }}>{entry.notes}</div>}
                  {entry.change_reason && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{entry.change_reason}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: DISCREPANCIES
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'discrepancies' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {open_discrepancies.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#334155' }}>
                <CheckCircle2 style={{ width: 40, height: 40, color: '#34d399', opacity: 0.4, margin: '0 auto 12px' }} />
                <div style={{ fontSize: 14, color: '#34d399' }}>لا توجد تعارضات مفتوحة لهذا الموظف</div>
              </div>
            ) : open_discrepancies.map((d) => {
              const color = SEVERITY_COLORS[d.severity] ?? '#94a3b8';
              return (
                <div key={d.id} style={{ background: `${color}08`, border: `1px solid ${color}30`, borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <AlertTriangle style={{ width: 14, height: 14, color }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color }}>{d.discrepancy_type.replaceAll('_', ' ')}</span>
                    <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 999, background: `${color}20`, color, fontWeight: 700 }}>{d.severity}</span>
                    <span style={{ marginRight: 'auto', fontSize: 10, color: '#334155' }}>
                      {new Date(d.first_detected_at).toLocaleDateString('ar-EG')}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>{d.description}</div>
                  {(d.source_a || d.source_b) && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {d.source_a && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', color: '#64748b' }}>المصدر أ: {d.source_a}</span>}
                      {d.source_b && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)', color: '#64748b' }}>المصدر ب: {d.source_b}</span>}
                      {d.value_a && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(251,113,133,0.1)', color: '#fb7185' }}>القيمة أ: {d.value_a}</span>}
                      {d.value_b && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, background: 'rgba(251,191,36,0.1)', color: '#f59e0b' }}>القيمة ب: {d.value_b}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>
  );
}
