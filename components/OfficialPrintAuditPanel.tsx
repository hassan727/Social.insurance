'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Download,
  RefreshCw,
  Search,
  Building2,
  FileText,
  UserX,
  UserCheck,
  Clock,
  XCircle,
  TrendingUp,
  Briefcase,
  ChevronDown,
  FileSpreadsheet,
} from 'lucide-react';
import type { MatchedForensicRecord, ForensicAuditSummary } from '@/lib/officialPrintMatchingService';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type AccountFilter = 'ALL' | 'E.G' | 'm.g';

interface AuditApiResponse {
  success: boolean;
  account: AccountFilter;
  summary: ForensicAuditSummary;
  recordsCount: number;
  sampleRecords: MatchedForensicRecord[];
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status badge config
// ─────────────────────────────────────────────────────────────────────────────
function getStatusBadge(status: MatchedForensicRecord['finalForensicStatus']): {
  bg: string;
  border: string;
  color: string;
  icon: React.ReactNode;
  label: string;
} {
  switch (status) {
    case 'مطابق ومعتمد':
      return { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.4)', color: '#34d399', icon: <CheckCircle2 size={13} />, label: 'مطابق ✓' };
    case 'تعيين جديد بعد تاريخ البرنت (22/09/2026)':
      return { bg: 'rgba(234,179,8,0.12)', border: 'rgba(234,179,8,0.4)', color: '#fbbf24', icon: <Clock size={13} />, label: 'تعيين جديد 🆕' };
    case 'تم توريد س1 بوارد التأمين وجارٍ الاعتماد':
      return { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.4)', color: '#60a5fa', icon: <FileText size={13} />, label: 'تم توريد س1 📋' };
    case 'مستقيل في شيت الاستقالات (RES)':
      return { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.4)', color: '#94a3b8', icon: <UserX size={13} />, label: 'مستقيل (RES)' };
    case 'مخالفة تأمينية مؤكدة (غير مؤمن عليه ولم يُرصد له توريد س1)':
      return { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.5)', color: '#f87171', icon: <AlertTriangle size={13} />, label: 'مخالفة مؤكدة ⚠️' };
    case 'مسجل بالتأمينات ولا يتقاضى راتباً بالمرتبات':
      return { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.4)', color: '#c084fc', icon: <UserCheck size={13} />, label: 'بلا مرتبات 🔍' };
    case 'تعارض مسميات وظيفية رسمي':
      return { bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.4)', color: '#fb923c', icon: <Briefcase size={13} />, label: 'تعارض وظيفي ⚠️' };
    case 'تعارض أرقام تأمينية أو أسماء':
      return { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)', color: '#fca5a5', icon: <XCircle size={13} />, label: 'تعارض بيانات 🔴' };
    default:
      return { bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.4)', color: '#94a3b8', icon: null, label: status };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary Card
// ─────────────────────────────────────────────────────────────────────────────
function SummaryCard({
  label, value, color, bg, border, icon, subtitle,
}: {
  label: string; value: number | string; color: string; bg: string; border: string;
  icon: React.ReactNode; subtitle?: string;
}) {
  return (
    <div style={{
      background: bg,
      border: `1px solid ${border}`,
      borderRadius: 14,
      padding: '1rem 1.25rem',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 140,
      flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color }}>
        {icon}
        <span style={{ fontSize: '0.78rem', fontWeight: 700, opacity: 0.9 }}>{label}</span>
      </div>
      <div style={{
        fontSize: '2rem', fontWeight: 900, color,
        fontFamily: "'IBM Plex Mono', monospace",
        fontVariantNumeric: 'tabular-nums slashed-zero',
      }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{subtitle}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Panel
// ─────────────────────────────────────────────────────────────────────────────
export default function OfficialPrintAuditPanel() {
  const [account, setAccount] = useState<AccountFilter>('ALL');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [summary, setSummary] = useState<ForensicAuditSummary | null>(null);
  const [sampleRecords, setSampleRecords] = useState<MatchedForensicRecord[]>([]);
  const [recordsCount, setRecordsCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingSubset, setExportingSubset] = useState<string | null>(null);
  const rowsPerPage = 15;

  // ── Fetch summary ──────────────────────────────────────────────────────────
  const fetchSummary = useCallback(async (acc: AccountFilter) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/official-print-audit?action=summary&account=${acc}`);
      const json: AuditApiResponse = await res.json();
      if (!json.success) throw new Error(json.error || 'فشل التدقيق الجنائي');
      setSummary(json.summary);
      setSampleRecords(json.sampleRecords || []);
      setRecordsCount(json.recordsCount || 0);
      setCurrentPage(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary(account);
  }, [account, fetchSummary]);

  // ── Export ─────────────────────────────────────────────────────────────────
  const handleExport = async (subset = 'all') => {
    setExporting(true);
    setExportingSubset(subset);
    try {
      const res = await fetch(`/api/official-print-audit?action=export&account=${account}&subset=${subset}`);
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || 'فشل تصدير الملف');
      }
      let filename = `تقرير_التدقيق_الجنائي_برنت_التامينات_2026_${account}.xlsx`;
      const disp = res.headers.get('content-disposition');
      if (disp) {
        const m = disp.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
        if (m?.[1]) filename = decodeURIComponent(m[1].replace(/['"]/g, ''));
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setExportMenuOpen(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء التصدير');
    } finally {
      setExporting(false);
      setExportingSubset(null);
    }
  };

  // ── Filter + Paginate ──────────────────────────────────────────────────────
  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return sampleRecords;
    const q = searchQuery.toLowerCase().trim();
    return sampleRecords.filter((r) =>
      r.nationalId?.includes(q) ||
      r.employeeCode?.toLowerCase().includes(q) ||
      r.employeeName?.toLowerCase().includes(q) ||
      r.insuredNameInPrint?.toLowerCase().includes(q) ||
      r.actualJobTitle?.toLowerCase().includes(q) ||
      r.companyAccount?.toLowerCase().includes(q)
    );
  }, [sampleRecords, searchQuery]);

  const totalPages = Math.ceil(filteredRecords.length / rowsPerPage) || 1;
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredRecords.slice(start, start + rowsPerPage);
  }, [filteredRecords, currentPage]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div dir="rtl" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Header & Controls ─────────────────────────────────────────────── */}
      <div style={{
        background: 'rgba(15,23,42,0.75)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(239,68,68,0.25)',
        borderRadius: 18,
        padding: '1.5rem 2rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          {/* Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14,
              background: 'linear-gradient(135deg, #dc2626, #9f1239)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 8px 24px rgba(220,38,38,0.4)',
            }}>
              <ShieldCheck size={26} color="#fff" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#f8fafc', margin: 0 }}>
                التدقيق الجنائي لبرنت التأمينات الاجتماعية
              </h2>
              <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
                مرجع البرنت الرسمي: 22/09/2026 — مطابقة شاملة بجميع الشيتات (6 مصادر بيانات)
              </span>
            </div>
          </div>

          {/* Controls Row */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Account Selector */}
            <div style={{ display: 'flex', gap: 0, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.2)' }}>
              {(['ALL', 'E.G', 'm.g'] as AccountFilter[]).map((acc) => (
                <button
                  key={acc}
                  onClick={() => setAccount(acc)}
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    transition: 'all 0.2s',
                    background: account === acc ? 'linear-gradient(135deg, #dc2626, #9f1239)' : 'rgba(15,23,42,0.6)',
                    color: account === acc ? '#fff' : '#64748b',
                  }}
                >
                  {acc === 'ALL' ? '🏢 الكل' : `🏭 ${acc}`}
                </button>
              ))}
            </div>

            {/* Refresh */}
            <button
              onClick={() => fetchSummary(account)}
              disabled={loading}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(148,163,184,0.2)',
                background: 'rgba(15,23,42,0.6)', color: '#94a3b8', fontWeight: 700,
                fontSize: '0.82rem', cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              تحديث
            </button>

            {/* Export Dropdown Group */}
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', boxShadow: !exporting && summary ? '0 4px 14px rgba(22,163,74,0.4)' : 'none' }}>
                <button
                  onClick={() => handleExport('all')}
                  disabled={exporting || loading || !summary}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 16px', border: 'none',
                    background: exporting || !summary ? 'rgba(100,116,139,0.3)' : 'linear-gradient(135deg, #16a34a, #15803d)',
                    color: exporting || !summary ? '#64748b' : '#fff',
                    fontWeight: 800, fontSize: '0.82rem',
                    cursor: exporting || loading || !summary ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <Download size={14} />
                  {exporting && exportingSubset === 'all' ? 'جاري التصدير...' : '📥 تصدير المصنف الشامل (7 شيتات)'}
                </button>
                <button
                  onClick={() => setExportMenuOpen(!exportMenuOpen)}
                  disabled={exporting || loading || !summary}
                  style={{
                    padding: '8px 10px', border: 'none', borderRight: '1px solid rgba(255,255,255,0.2)',
                    background: exporting || !summary ? 'rgba(100,116,139,0.3)' : 'linear-gradient(135deg, #15803d, #166534)',
                    color: '#fff', cursor: exporting || loading || !summary ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
                  }}
                  title="خيارات تصدير التقارير الفردية"
                >
                  <ChevronDown size={14} />
                </button>
              </div>

              {/* Dropdown Menu */}
              {exportMenuOpen && (
                <div style={{
                  position: 'absolute', top: '115%', left: 0, zIndex: 100,
                  minWidth: 280, background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(16px)',
                  border: '1px solid rgba(148,163,184,0.25)', borderRadius: 12, padding: '6px',
                  boxShadow: '0 12px 32px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  <div style={{ padding: '6px 10px', fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, borderBottom: '1px solid rgba(148,163,184,0.1)' }}>
                    📊 تصدير كل تقرير على حدة (Excel):
                  </div>
                  {[
                    { id: 'all', label: '📑 المصنف الشامل الكامل (7 شيتات)', icon: FileSpreadsheet, color: '#38bdf8' },
                    { id: 'job_conflicts', label: '💼 تقرير التعارض الوظيفي وتعديل المهن', icon: Briefcase, color: '#fb923c' },
                    { id: 'matched', label: '👥 تقرير المطابقة التامة بين البرنت والمرتبات', icon: CheckCircle2, color: '#34d399' },
                    { id: 'missing_in_print', label: '⚠️ تقرير غير المسجلين بالبرنت والمخالفات وس1', icon: AlertTriangle, color: '#f87171' },
                    { id: 'missing_in_payroll', label: '🚪 تقرير المسجلين بلا مرتبات واستمارة 6', icon: UserX, color: '#c084fc' },
                    { id: 'discrepancies', label: '🔄 تقرير تناقض البيانات والأجور والشركات', icon: XCircle, color: '#fca5a5' },
                    { id: 'actions', label: '📋 تقرير الإجراءات التنفيذية ونماذج التعديل', icon: FileText, color: '#a78bfa' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleExport(item.id)}
                      disabled={exporting}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                        background: 'transparent', border: 'none', borderRadius: 8,
                        color: '#f8fafc', fontSize: '0.78rem', fontWeight: 600,
                        cursor: 'pointer', textAlign: 'right', width: '100%',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <item.icon size={14} style={{ color: item.color }} />
                      <span style={{ flex: 1 }}>{item.label}</span>
                      {exporting && exportingSubset === item.id && <span style={{ fontSize: '0.68rem', color: '#38bdf8' }}>جاري...</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Error State ───────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 14, padding: '1rem 1.5rem',
          display: 'flex', alignItems: 'center', gap: 10, color: '#fca5a5',
        }}>
          <AlertTriangle size={18} />
          <span style={{ fontWeight: 600 }}>{error}</span>
        </div>
      )}

      {/* ── Loading State ─────────────────────────────────────────────────── */}
      {loading && (
        <div style={{
          background: 'rgba(15,23,42,0.65)', borderRadius: 16,
          border: '1px solid rgba(148,163,184,0.1)',
          padding: '3rem', textAlign: 'center', color: '#94a3b8',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: 10 }}>⚙️</div>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>جاري تشغيل محرك التدقيق الجنائي...</div>
          <div style={{ fontSize: '0.82rem', marginTop: 6, color: '#64748b' }}>
            يتم فحص 6 مصادر بيانات وإجراء المطابقة الثنائية المرحلة
          </div>
        </div>
      )}

      {/* ── Summary Cards ─────────────────────────────────────────────────── */}
      {!loading && summary && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.85rem' }}>
            <SummaryCard
              label="إجمالي الموظفين المحللين"
              value={summary.totalUniqueEmployeesAnalyzed}
              color="#38bdf8" bg="rgba(56,189,248,0.1)" border="rgba(56,189,248,0.3)"
              icon={<TrendingUp size={16} />}
              subtitle={`حساب: ${account}`}
            />
            <SummaryCard
              label="مطابق ومعتمد ✓"
              value={summary.matchedCount}
              color="#34d399" bg="rgba(16,185,129,0.1)" border="rgba(16,185,129,0.3)"
              icon={<CheckCircle2 size={16} />}
              subtitle="موجود بالبرنت والمرتبات"
            />
            <SummaryCard
              label="مخالفة تأمينية مؤكدة ⚠️"
              value={summary.confirmedUninsuredCount}
              color="#f87171" bg="rgba(239,68,68,0.12)" border="rgba(239,68,68,0.4)"
              icon={<AlertTriangle size={16} />}
              subtitle="يلزم تقديم س1 عاجل"
            />
            <SummaryCard
              label="تم توريد س1 📋"
              value={summary.suppliedS1Count}
              color="#60a5fa" bg="rgba(59,130,246,0.1)" border="rgba(59,130,246,0.3)"
              icon={<FileText size={16} />}
              subtitle="وارد التأمين برقم CRM"
            />
            <SummaryCard
              label="تعيين جديد 🆕"
              value={summary.hiredAfterPrintDateCount}
              color="#fbbf24" bg="rgba(234,179,8,0.1)" border="rgba(234,179,8,0.3)"
              icon={<Clock size={16} />}
              subtitle="بعد 22/09/2026"
            />
            <SummaryCard
              label="تعارض مسميات ⚠️"
              value={summary.jobTitleConflictCount}
              color="#fb923c" bg="rgba(249,115,22,0.1)" border="rgba(249,115,22,0.3)"
              icon={<Briefcase size={16} />}
              subtitle="وظيفة المرتبات ≠ التأمينات"
            />
            <SummaryCard
              label="بالتأمينات بلا مرتبات 🔍"
              value={summary.missingInPayrollCount}
              color="#c084fc" bg="rgba(168,85,247,0.1)" border="rgba(168,85,247,0.3)"
              icon={<UserCheck size={16} />}
              subtitle="مسجل تأمينياً فقط"
            />
            <SummaryCard
              label="تناقض بيانات 🔴"
              value={summary.dataDiscrepancyCount}
              color="#fca5a5" bg="rgba(239,68,68,0.08)" border="rgba(239,68,68,0.3)"
              icon={<XCircle size={16} />}
              subtitle="أرقام تأمين / أسماء مختلفة"
            />
          </div>

          {/* ── Audit Meta Info ──────────────────────────────────────────── */}
          <div style={{
            background: 'rgba(15,23,42,0.5)',
            border: '1px solid rgba(148,163,184,0.1)',
            borderRadius: 12,
            padding: '0.85rem 1.25rem',
            display: 'flex', flexWrap: 'wrap', gap: '1.5rem',
            fontSize: '0.8rem', color: '#64748b',
          }}>
            <span>📅 تاريخ التدقيق: <strong style={{ color: '#94a3b8' }}>{summary.auditDate}</strong></span>
            <span>📋 مرجع البرنت: <strong style={{ color: '#f87171' }}>{summary.printReferenceDate}</strong></span>
            <span>👥 إجمالي السجلات المحللة: <strong style={{ color: '#38bdf8', fontFamily: 'IBM Plex Mono, monospace' }}>{recordsCount}</strong></span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Building2 size={12} />
              {account === 'ALL' ? 'جميع الحسابات (E.G + m.g)' : `حساب: ${account}`}
            </span>
          </div>

          {/* ── Violation Alert Banner (if any) ──────────────────────────── */}
          {summary.confirmedUninsuredCount > 0 && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(185,28,28,0.2) 100%)',
              border: '1px solid rgba(239,68,68,0.5)',
              borderRadius: 14,
              padding: '1rem 1.5rem',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <AlertTriangle size={22} color="#f87171" style={{ flexShrink: 0 }} />
              <div>
                <div style={{ fontWeight: 800, color: '#fca5a5', fontSize: '0.95rem' }}>
                  🚨 تنبيه: {summary.confirmedUninsuredCount} موظف بمخالفة تأمينية مؤكدة
                </div>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 3 }}>
                  هؤلاء الموظفون يتقاضون مرتبات وليس لهم أي سجل بالبرنت أو وارد التأمين أو استقالة.
                  يستلزم الأمر تقديم استمارة س1 لكل منهم فوراً.
                </div>
              </div>
            </div>
          )}

          {/* ── Sample Records Table ───────────────────────────────────────── */}
          <div style={{
            background: 'rgba(15,23,42,0.65)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(148,163,184,0.1)',
            borderRadius: 16,
            overflow: 'hidden',
          }}>
            {/* Table Header */}
            <div style={{
              padding: '1rem 1.5rem',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
              borderBottom: '1px solid rgba(148,163,184,0.1)',
            }}>
              <div style={{ fontWeight: 800, color: '#f1f5f9', fontSize: '0.95rem' }}>
                📋 عينة السجلات المحللة
                <span style={{ fontSize: '0.78rem', color: '#64748b', marginRight: 10, fontWeight: 500 }}>
                  (عرض أول 50 سجل — صدّر الملف للاطلاع على الجميع)
                </span>
              </div>

              {/* Search */}
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  placeholder="بحث بالاسم / كود / رقم قومي..."
                  style={{
                    paddingRight: 32, paddingLeft: 12, paddingTop: 7, paddingBottom: 7,
                    borderRadius: 10, border: '1px solid rgba(148,163,184,0.2)',
                    background: 'rgba(15,23,42,0.6)', color: '#f1f5f9', fontSize: '0.82rem',
                    width: 240,
                  }}
                />
              </div>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', direction: 'rtl' }}>
                <thead>
                  <tr style={{ background: 'rgba(15,23,42,0.5)' }}>
                    {[
                      'المعرف المركب',
                      'الشركة',
                      'الرقم القومي',
                      'الاسم (الشركة)',
                      'الاسم (البرنت)',
                      'الوظيفة الفعلية',
                      'المهنة بالتأمينات',
                      'الحالة التأمينية',
                      'التصنيف الجنائي',
                    ].map((col) => (
                      <th key={col} style={{
                        padding: '10px 12px', textAlign: 'right',
                        color: '#94a3b8', fontWeight: 700, fontSize: '0.75rem',
                        borderBottom: '1px solid rgba(148,163,184,0.1)',
                        whiteSpace: 'nowrap',
                      }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginatedRecords.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                        {loading ? 'جاري التحميل...' : searchQuery ? 'لا توجد نتائج للبحث' : 'لا توجد سجلات'}
                      </td>
                    </tr>
                  ) : (
                    paginatedRecords.map((rec, idx) => {
                      const badge = getStatusBadge(rec.finalForensicStatus);
                      const isEven = idx % 2 === 0;
                      return (
                        <tr
                          key={`${rec.compositeKey}-${idx}`}
                          style={{
                            background: isEven ? 'transparent' : 'rgba(15,23,42,0.3)',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(56,189,248,0.07)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = isEven ? 'transparent' : 'rgba(15,23,42,0.3)')}
                        >
                          {/* المعرف المركب */}
                          <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
                            <span style={{
                              fontFamily: 'IBM Plex Mono, monospace',
                              fontSize: '0.73rem', color: '#38bdf8',
                              fontVariantNumeric: 'tabular-nums slashed-zero',
                            }}>
                              {rec.compositeKey || '—'}
                            </span>
                          </td>

                          {/* الشركة */}
                          <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 6,
                              background: rec.companyAccount === 'E.G' ? 'rgba(99,102,241,0.15)' : 'rgba(234,179,8,0.15)',
                              color: rec.companyAccount === 'E.G' ? '#818cf8' : '#fbbf24',
                              fontSize: '0.72rem', fontWeight: 700,
                            }}>
                              {rec.companyAccount || '—'}
                            </span>
                          </td>

                          {/* الرقم القومي */}
                          <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
                            <span style={{
                              fontFamily: 'IBM Plex Mono, monospace',
                              fontSize: '0.75rem', color: '#e2e8f0',
                              fontVariantNumeric: 'tabular-nums slashed-zero',
                              letterSpacing: '0.03em',
                            }}>
                              {rec.nationalId || '—'}
                            </span>
                          </td>

                          {/* الاسم بالشركة */}
                          <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.06)', maxWidth: 160 }}>
                            <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.78rem' }}>
                              {rec.employeeName || '—'}
                            </span>
                          </td>

                          {/* الاسم بالبرنت */}
                          <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.06)', maxWidth: 160 }}>
                            <span style={{
                              color: rec.nameMatchConfidence === 'متطابق تماماً' ? '#34d399'
                                : rec.nameMatchConfidence === 'غير مسجل بالبرنت' ? '#f87171'
                                : '#fbbf24',
                              fontSize: '0.78rem',
                            }}>
                              {rec.insuredNameInPrint || <em style={{ color: '#64748b' }}>غير مسجل</em>}
                            </span>
                          </td>

                          {/* الوظيفة الفعلية */}
                          <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
                            <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                              {rec.actualJobTitle || '—'}
                            </span>
                          </td>

                          {/* المهنة بالتأمينات */}
                          <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
                            <span style={{
                              color: rec.jobConflictStatus === 'تعارض مسميات' ? '#fb923c' : '#94a3b8',
                              fontSize: '0.78rem', fontWeight: rec.jobConflictStatus === 'تعارض مسميات' ? 700 : 400,
                            }}>
                              {rec.insuranceJobTitle || '—'}
                            </span>
                          </td>

                          {/* الحالة التأمينية */}
                          <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
                            <span style={{
                              fontFamily: 'IBM Plex Mono, monospace',
                              fontSize: '0.72rem',
                              color: rec.foundInPrint ? '#34d399' : '#64748b',
                            }}>
                              {rec.foundInPrint ? '✓ بالبرنت' : '✗ غير موجود'}
                            </span>
                          </td>

                          {/* التصنيف الجنائي */}
                          <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
                            <div style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              padding: '3px 10px', borderRadius: 20,
                              background: badge.bg, border: `1px solid ${badge.border}`,
                              color: badge.color, fontSize: '0.72rem', fontWeight: 700,
                              whiteSpace: 'nowrap',
                            }}>
                              {badge.icon}
                              {badge.label}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 10, padding: '1rem',
                borderTop: '1px solid rgba(148,163,184,0.1)',
              }}>
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  style={{
                    padding: '5px 14px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.2)',
                    background: 'transparent', color: currentPage === 1 ? '#374151' : '#94a3b8',
                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer', fontWeight: 700,
                  }}
                >
                  ›
                </button>
                <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                  صفحة {currentPage} من {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  style={{
                    padding: '5px 14px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.2)',
                    background: 'transparent', color: currentPage === totalPages ? '#374151' : '#94a3b8',
                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', fontWeight: 700,
                  }}
                >
                  ‹
                </button>
              </div>
            )}
          </div>

          {/* ── Action Required Preview ───────────────────────────────────── */}
          {paginatedRecords.some((r) => r.actionRequired) && (
            <div style={{
              background: 'rgba(15,23,42,0.5)',
              border: '1px solid rgba(148,163,184,0.1)',
              borderRadius: 14,
              padding: '1.25rem 1.5rem',
            }}>
              <div style={{ fontWeight: 800, color: '#f1f5f9', marginBottom: 12, fontSize: '0.9rem' }}>
                📌 الإجراءات المطلوبة للصفحة الحالية
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {paginatedRecords
                  .filter((r) => r.actionRequired && r.finalForensicStatus !== 'مطابق ومعتمد')
                  .slice(0, 10)
                  .map((rec, i) => {
                    const badge = getStatusBadge(rec.finalForensicStatus);
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: '8px 12px', borderRadius: 10,
                          background: badge.bg, border: `1px solid ${badge.border}`,
                          fontSize: '0.78rem',
                        }}
                      >
                        <span style={{ color: badge.color, flexShrink: 0 }}>{badge.icon}</span>
                        <div>
                          <span style={{ fontWeight: 700, color: badge.color }}>
                            {rec.employeeName || rec.nationalId}
                          </span>
                          <span style={{ color: '#64748b', marginRight: 8 }}>
                            ({rec.compositeKey})
                          </span>
                          <span style={{ color: '#94a3b8' }}>→ {rec.actionRequired}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}

      {/* CSS for spin animation */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&display=swap');
      `}</style>
    </div>
  );
}
