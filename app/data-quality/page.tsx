'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CheckCircle2, RefreshCw, Play, ExternalLink,
  ShieldAlert, Info, XCircle, Clock, BarChart3,
  ChevronDown, ChevronUp,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface DiscrepancyStats {
  total_open: number;
  by_type: Array<{ discrepancy_type: string; count: number; severity: string }>;
  by_severity: { critical: number; warning: number; info: number };
  last_run_at: string | null;
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
  last_checked_at: string;
  employee_id: string | null;
  raw_employee_code: string | null;
  raw_national_id: string | null;
  raw_employee_name: string | null;
  employees_master?: { employee_code: string | null; employee_name: string; company_account: string; current_status: string | null } | null;
}

interface QualityRunSummary {
  success: boolean;
  run_id: string;
  duration_ms: number;
  total_employees_checked: number;
  discrepancies_found: number;
  new_discrepancies: number;
  by_type: Record<string, number>;
  by_severity: { critical: number; warning: number; info: number };
  errors: string[];
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#fb7185',
  warning: '#f59e0b',
  info: '#94a3b8',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: '🔴 حرج',
  warning: '🟡 تحذير',
  info: '🔵 معلومة',
};

const TYPE_LABELS: Record<string, string> = {
  active_in_db_resigned_in_res: 'Active في DB ومستقيل في RES',
  active_no_insurance_number: 'Active بلا رقم تأميني',
  national_id_multiple_codes: 'رقم قومي متكرر في أكثر من كود',
  insurance_number_multiple_employees: 'رقم تأميني لأكثر من موظف',
  in_insurance_not_in_db: 'في التأمينات وغير موجود في DB',
  in_db_not_in_insurance: 'في DB وغير موجود في التأمينات',
  duplicate_bank_account: 'حساب بنكي مكرر',
  multiple_job_titles: 'أكثر من وظيفة بين الملفات',
  insurance_ended_still_active: 'انتهى التأمين والموظف لا يزال Active',
  job_title_mismatch_insurance: 'اختلاف الوظيفة في التأمينات',
  salary_mismatch: 'اختلاف الأجر بين المصادر',
  missing_national_id: 'بلا رقم قومي',
  missing_phone: 'بلا رقم هاتف',
  missing_hire_date: 'بلا تاريخ استلام عمل',
  missing_insurance_number: 'بلا رقم تأميني',
  name_variation_same_code: 'تغيير اسم لنفس الكود',
  code_in_insurance_not_in_master: 'كود في التأمينات غير موجود في Master',
};

// ═══════════════════════════════════════════════════════════════════════════
// CARD COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

function StatCard({ label, value, color, icon }: {
  label: string; value: number; color: string; icon: React.ReactNode;
}) {
  return (
    <div style={{ background: `${color}0f`, border: `1px solid ${color}30`, borderRadius: 14, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color, flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 24, fontWeight: 900, color, lineHeight: 1 }}>{value.toLocaleString('ar-EG')}</div>
        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, marginTop: 2 }}>{label}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function DataQualityPage() {
  const [stats, setStats] = useState<DiscrepancyStats | null>(null);
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [selectedType, setSelectedType] = useState<string>('');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('');
  const [loadingList, setLoadingList] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRunResult, setLastRunResult] = useState<QualityRunSummary | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadStats = async () => {
    try {
      const res = await fetch('/api/data-quality?mode=stats');
      const json = await res.json();
      setStats(json.stats);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const loadList = async (type?: string, severity?: string) => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams({ mode: 'list', limit: '100' });
      if (type) params.set('type', type);
      if (severity) params.set('severity', severity);
      const res = await fetch(`/api/data-quality?${params}`);
      const json = await res.json();
      setDiscrepancies(json.discrepancies ?? []);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => { 
    loadStats(); 
    loadList(selectedType || undefined, selectedSeverity || undefined); 
  }, []);
  
  useEffect(() => { 
    loadList(selectedType || undefined, selectedSeverity || undefined); 
  }, [selectedType, selectedSeverity]);

  const runCheck = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/data-quality', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggered_by: 'manual' }),
      });
      const json = await res.json();
      setLastRunResult(json.summary);
      await loadStats();
      await loadList(selectedType || undefined, selectedSeverity || undefined);
    } finally {
      setRunning(false);
    }
  };

  const resolve = async (id: string, action: 'resolved' | 'ignored' | 'false_positive') => {
    await fetch('/api/data-quality', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    setDiscrepancies((prev) => prev.filter((d) => d.id !== id));
    if (stats) {
      setStats((s) => s ? { ...s, total_open: s.total_open - 1 } : s);
    }
  };

  return (
    <div style={{ padding: '24px 20px' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldAlert style={{ width: 20, height: 20, color: '#f59e0b' }} />
              مركز جودة البيانات والتعارضات
            </h1>
            <p style={{ fontSize: 12, color: '#475569', margin: '4px 0 0' }}>
              اكتشاف وتتبع التعارضات والبيانات الناقصة والأخطاء عبر جميع المصادر
              {stats?.last_run_at && (
                <span style={{ marginRight: 8, color: '#334155' }}>
                  · آخر فحص: {new Date(stats.last_run_at).toLocaleString('ar-EG')}
                </span>
              )}
            </p>
          </div>
          <button
            onClick={runCheck}
            disabled={running}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 12,
              background: running ? 'rgba(99,102,241,0.1)' : 'linear-gradient(135deg, #4338ca, #6366f1)',
              border: '1px solid rgba(99,102,241,0.4)',
              color: '#fff', fontSize: 13, fontWeight: 700, cursor: running ? 'default' : 'pointer',
              boxShadow: running ? 'none' : '0 4px 20px rgba(99,102,241,0.3)',
            }}
          >
            {running
              ? <><RefreshCw style={{ width: 14, height: 14, animation: 'spin 0.8s linear infinite' }} />جاري الفحص...</>
              : <><Play style={{ width: 14, height: 14 }} />تشغيل فحص شامل</>
            }
          </button>
        </div>

        {/* ── Last Run Result ── */}
        {lastRunResult && (
          <div style={{ marginBottom: 20, padding: '14px 18px', borderRadius: 12, background: lastRunResult.success ? 'rgba(52,211,153,0.08)' : 'rgba(251,113,133,0.08)', border: `1px solid ${lastRunResult.success ? 'rgba(52,211,153,0.25)' : 'rgba(251,113,133,0.25)'}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: lastRunResult.success ? '#34d399' : '#fb7185', marginBottom: 6 }}>
              {lastRunResult.success ? '✅' : '⚠️'} نتيجة الفحص — {lastRunResult.duration_ms}ms
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: '#64748b' }}>
              <span>موظفين تم فحصهم: <strong style={{ color: '#e2e8f0' }}>{lastRunResult.total_employees_checked}</strong></span>
              <span>تعارضات مكتشفة: <strong style={{ color: '#f59e0b' }}>{lastRunResult.discrepancies_found}</strong></span>
              <span>جديدة: <strong style={{ color: '#fb7185' }}>{lastRunResult.new_discrepancies}</strong></span>
              {lastRunResult.errors.length > 0 && <span style={{ color: '#fb7185' }}>أخطاء: {lastRunResult.errors.join('; ')}</span>}
            </div>
          </div>
        )}

        {/* ── Stats Cards ── */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
            <StatCard label="إجمالي التعارضات المفتوحة" value={stats.total_open} color="#818cf8" icon={<BarChart3 style={{ width: 18, height: 18 }} />} />
            <StatCard label="حرجة" value={stats.by_severity.critical} color="#fb7185" icon={<XCircle style={{ width: 18, height: 18 }} />} />
            <StatCard label="تحذيرات" value={stats.by_severity.warning} color="#f59e0b" icon={<AlertTriangle style={{ width: 18, height: 18 }} />} />
            <StatCard label="معلوماتية" value={stats.by_severity.info} color="#38bdf8" icon={<Info style={{ width: 18, height: 18 }} />} />
          </div>
        )}

        {/* ── Type breakdown ── */}
        {stats && stats.by_type.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            <button
              onClick={() => setSelectedType('')}
              style={{ padding: '5px 12px', borderRadius: 8, background: !selectedType ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${!selectedType ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`, color: !selectedType ? '#818cf8' : '#475569', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
            >
              الكل ({stats.total_open})
            </button>
            {stats.by_type.map(({ discrepancy_type, count, severity }) => {
              const color = SEVERITY_COLORS[severity] ?? '#94a3b8';
              const isSelected = selectedType === discrepancy_type;
              return (
                <button
                  key={discrepancy_type}
                  onClick={() => setSelectedType(isSelected ? '' : discrepancy_type)}
                  style={{ padding: '5px 12px', borderRadius: 8, background: isSelected ? `${color}20` : 'rgba(255,255,255,0.04)', border: `1px solid ${isSelected ? `${color}50` : 'rgba(255,255,255,0.08)'}`, color: isSelected ? color : '#475569', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >
                  {TYPE_LABELS[discrepancy_type] ?? discrepancy_type} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* ── Discrepancies List ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loadingList ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#334155' }}>
              <RefreshCw style={{ width: 24, height: 24, animation: 'spin 0.8s linear infinite', margin: '0 auto 10px', display: 'block' }} />
              جاري تحميل التعارضات...
            </div>
          ) : discrepancies.length === 0 ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#334155' }}>
              <CheckCircle2 style={{ width: 40, height: 40, color: '#34d399', opacity: 0.4, margin: '0 auto 12px', display: 'block' }} />
              <div style={{ fontSize: 14, color: '#34d399' }}>لا توجد تعارضات مفتوحة</div>
              <div style={{ fontSize: 12, color: '#334155', marginTop: 4 }}>قم بتشغيل فحص شامل للكشف عن أي تعارضات جديدة</div>
            </div>
          ) : discrepancies.map((d) => {
            const color = SEVERITY_COLORS[d.severity] ?? '#94a3b8';
            const isExpanded = expanded === d.id;
            const emp = d.employees_master;
            const empName = emp?.employee_name ?? d.raw_employee_name ?? '—';
            const empCode = emp?.employee_code ?? d.raw_employee_code ?? '—';
            const empAccount = emp?.company_account ?? '—';

            return (
              <div key={d.id} style={{ background: `${color}06`, border: `1px solid ${color}25`, borderRadius: 12, overflow: 'hidden' }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer' }}
                  onClick={() => setExpanded(isExpanded ? null : d.id)}
                >
                  {/* Severity dot */}
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />

                  {/* Employee info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{empName}</span>
                      <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: '#818cf8' }}>{empCode}</span>
                      <span style={{ fontSize: 10, color: '#475569' }}>{empAccount}</span>
                      <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 999, background: `${color}20`, color, fontWeight: 700 }}>
                        {SEVERITY_LABELS[d.severity] ?? d.severity}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {TYPE_LABELS[d.discrepancy_type] ?? d.discrepancy_type}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {/* Go to employee profile */}
                    {d.employee_id && (
                      <Link
                        href={`/employee/${d.employee_id}`}
                        onClick={(e) => e.stopPropagation()}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 7, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8', textDecoration: 'none' }}
                        title="ملف الموظف"
                      >
                        <ExternalLink style={{ width: 11, height: 11 }} />
                      </Link>
                    )}
                    {isExpanded ? <ChevronUp style={{ width: 14, height: 14, color: '#475569' }} /> : <ChevronDown style={{ width: 14, height: 14, color: '#475569' }} />}
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${color}15` }}>
                    {/* Description */}
                    <div style={{ padding: '10px 0', fontSize: 12, color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      {d.description}
                    </div>

                    {/* Value comparison */}
                    {(d.value_a || d.value_b) && (
                      <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                        {d.source_a && d.value_a && (
                          <div style={{ flex: 1, minWidth: 120, padding: '8px 10px', borderRadius: 8, background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.2)' }}>
                            <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, marginBottom: 3 }}>{d.source_a}</div>
                            <div style={{ fontSize: 12, color: '#fb7185', fontWeight: 700 }}>{d.value_a}</div>
                          </div>
                        )}
                        {d.source_b && d.value_b && (
                          <div style={{ flex: 1, minWidth: 120, padding: '8px 10px', borderRadius: 8, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}>
                            <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, marginBottom: 3 }}>{d.source_b}</div>
                            <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 700 }}>{d.value_b}</div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Meta */}
                    <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 10, color: '#334155', flexWrap: 'wrap' }}>
                      <span><Clock style={{ width: 9, height: 9, display: 'inline', marginLeft: 2 }} />اكتشف: {new Date(d.first_detected_at).toLocaleDateString('ar-EG')}</span>
                      {d.field_name && <span>الحقل: {d.field_name}</span>}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button
                        onClick={() => resolve(d.id, 'resolved')}
                        style={{ padding: '5px 12px', borderRadius: 7, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        ✅ تم الحل
                      </button>
                      <button
                        onClick={() => resolve(d.id, 'ignored')}
                        style={{ padding: '5px 12px', borderRadius: 7, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        تجاهل
                      </button>
                      <button
                        onClick={() => resolve(d.id, 'false_positive')}
                        style={{ padding: '5px 12px', borderRadius: 7, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                      >
                        إيجابية كاذبة
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
    </div>
  );
}
