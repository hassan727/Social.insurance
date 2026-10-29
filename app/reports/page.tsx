'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Navbar from '@/components/Navbar';
import {
  FileSpreadsheet,
  Download,
  RefreshCw,
  Search,
  FileDown,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Calendar,
  Layers,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Trash2,
  DatabaseZap,
  XCircle,
  Scale,
} from 'lucide-react';

interface ReportColumn {
  key: string;
  label: string;
  width?: number;
}

interface ReportSummary {
  totalEmployees: number;
  activeInPeriod: number;
  avgWage: number;
  totalPayroll: number;
  totalEmployerInsurance: number;
  minWageComplianceCount: number;
  warningsCount: number;
}

export interface DepartmentSummaryItem {
  department: string;
  region: string;
  employeeCount: number;
  totalInsWage: number;
  totalWorker11: number;
  totalEmployer1875: number;
  totalInsuranceContribution: number;
  totalPayroll: number;
  avgWage: number;
  matchedCount: number;
  unmatchedCount: number;
}

export interface MonthComparisonSummary {
  currentMonth: number;
  currentMonthName: string;
  previousMonth: number;
  previousMonthName: string;
  hasPreviousData: boolean;
  currentEmployees: number;
  previousEmployees: number;
  diffEmployees: number;
  currentInsWage: number;
  previousInsWage: number;
  diffInsWage: number;
  currentEmployer1875: number;
  previousEmployer1875: number;
  diffEmployer1875: number;
  currentWorker11: number;
  previousWorker11: number;
  diffWorker11: number;
  currentTotal2975: number;
  previousTotal2975: number;
  diffTotal2975: number;
  newHiresCount: number;
  terminatedCount: number;
}

interface ReportData {
  summary: ReportSummary;
  summaryRow: Record<string, unknown>;
  monthComparison?: MonthComparisonSummary;
  departmentSummary: DepartmentSummaryItem[];
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  reportTitle: string;
  account: string;
  period: string;
}

interface ImportLog {
  source_type: string;
  period_month: number | null;
  period_year: number | null;
  file_name: string;
  rows_accepted: number;
}

const MONTH_NAMES: Record<number, string> = {
  1: 'يناير', 2: 'فبراير', 3: 'مارس', 4: 'أبريل', 5: 'مايو', 6: 'يونيو',
  7: 'يوليو', 8: 'أغسطس', 9: 'سبتمبر', 10: 'أكتوبر', 11: 'نوفمبر', 12: 'ديسمبر',
};

// Report Meta Configuration for Smart Adaptive Controls
const REPORT_CONFIGS: Record<string, {
  label: string;
  description: string;
  periodType: 'quarter' | 'month' | 'none';
  showMethod: boolean;
  recommendedPeriod?: string | number;
}> = {
  hr_letter: {
    label: '📄 تقرير HR Letter ومتوسطات الأجور (Q1, Q2, Q3, Q4)',
    description: 'حساب متوسط الأجور بدقة وفقاً لشهور العمل الفعلية أو القسمة الصارمة للمطابقة البنكية والرسمية',
    periodType: 'quarter',
    showMethod: true,
    recommendedPeriod: 'Q3',
  },
  insurance_invoice: {
    label: '🧾 الفاتورة التأمينية والمطالبة الشهرية (المطابقة والرقابة)',
    description: 'مطابقة استقطاعات 11% للعامل و18.75% لحصة صاحب العمل شهرياً ورصد الفروقات',
    periodType: 'month',
    showMethod: false,
    recommendedPeriod: 9,
  },
  compliance_2026: {
    label: '⚖️ مراجعة ومطابقة قوانين 2026 (الحد الأدنى 7,000 + التأمينات)',
    description: 'فحص التزام الرواتب بالحد الأدنى 7,000 ج.م والحدود التأمينية (2,700 - 16,700 ج.م)',
    periodType: 'quarter',
    showMethod: false,
    recommendedPeriod: 'Q3',
  },
  tcoe_costs: {
    label: '💼 التكلفة الشاملة للعمالة والموازنة (TCOE)',
    description: 'حساب التكلفة الإجمالية للشركة (الراتب الفعلي + حصة التأمينات 18.75%) للربع أو السنة',
    periodType: 'quarter',
    showMethod: false,
    recommendedPeriod: 'Q3',
  },
  resignation_audit: {
    label: '🚪 حركة الاستقالات وتوريد استمارة 6',
    description: 'تدقيق تواريخ الاستقالة ونهاية الخدمة وتوريد استمارة 6 ومنع الصرف غير القانوني',
    periodType: 'none',
    showMethod: false,
  },
  comprehensive_master: {
    label: '📊 كشف المرتبات الشامل والتفصيلي',
    description: 'كشف مجمع لكل الموظفين والرواتب والبيانات التأمينية والإدارية للحساب',
    periodType: 'quarter',
    showMethod: false,
    recommendedPeriod: 'ANNUAL',
  },
};

export default function ReportsPage() {
  const [account, setAccount] = useState<'E.G' | 'm.g' | 'ALL'>('E.G');
  const [reportType, setReportType] = useState<string>('hr_letter');
  const [quarter, setQuarter] = useState<string>('Q3');
  const [month, setMonth] = useState<number>(9);
  const [method, setMethod] = useState<string>('actual');

  const [loading, setLoading] = useState<boolean>(false);
  const [isCachedHit, setIsCachedHit] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportData | null>(null);

  // Search and Pagination
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const rowsPerPage = 50;

  // Import Logs (for available months panel)
  const [importLogs, setImportLogs] = useState<ImportLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  // Client-Side Cache (Instant 0ms switching)
  const cacheRef = React.useRef<Map<string, ReportData>>(new Map());
  const abortControllerRef = React.useRef<AbortController | null>(null);

  // Delete modal state
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    sourceType: string;
    month: number;
    year: number;
    label: string;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ success?: string; error?: string } | null>(null);

  // Generate insurance state
  const [generateLoading, setGenerateLoading] = useState(false);

  // Group import logs by month for display & smart status
  const monthlyStatus = useMemo(() => {
    const map: Record<number, { payroll: boolean; insurance: boolean; payrollRows: number; insuranceRows: number }> = {};
    importLogs.forEach((log) => {
      if (!log.period_month) return;
      if (!map[log.period_month]) {
        map[log.period_month] = { payroll: false, insurance: false, payrollRows: 0, insuranceRows: 0 };
      }
      if (log.source_type === 'monthly_payroll') {
        map[log.period_month].payroll = true;
        map[log.period_month].payrollRows += log.rows_accepted || 0;
      }
      if (log.source_type === 'monthly_insurance') {
        map[log.period_month].insurance = true;
        map[log.period_month].insuranceRows += log.rows_accepted || 0;
      }
    });
    return map;
  }, [importLogs]);

  // Quarter Data Availability helper
  const quarterStatus = useMemo(() => {
    const checkQuarter = (months: number[]) => {
      let payrollMonths = 0;
      let insuranceMonths = 0;
      months.forEach((m) => {
        if (monthlyStatus[m]?.payroll) payrollMonths++;
        if (monthlyStatus[m]?.insurance) insuranceMonths++;
      });
      return {
        hasData: payrollMonths > 0 || insuranceMonths > 0,
        payrollMonths,
        insuranceMonths,
        isComplete: payrollMonths === months.length && insuranceMonths === months.length,
        total: months.length,
      };
    };

    return {
      Q1: checkQuarter([1, 2, 3]),
      Q2: checkQuarter([4, 5, 6]),
      Q3: checkQuarter([7, 8, 9]),
      Q4: checkQuarter([10, 11, 12]),
      ANNUAL: checkQuarter([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    };
  }, [monthlyStatus]);

  // Current report configuration
  const currentConfig = REPORT_CONFIGS[reportType] || REPORT_CONFIGS.hr_letter;

  // Fetch import logs to display available months
  const fetchImportLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await fetch('/api/import/logs');
      if (!res.ok) return;
      const json = await res.json();
      setImportLogs(json.logs || []);
    } catch {
      // silently fail
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchImportLogs();
  }, [fetchImportLogs]);

  // Smart Fast Fetch Report with In-Memory Caching & Abort Controller
  const fetchReport = useCallback(async (forceRefresh = false) => {
    const cacheKey = `${account}_${reportType}_${quarter}_${month}_${method}`;

    // 1. Instant Cache hit (0ms preview)
    if (!forceRefresh && cacheRef.current.has(cacheKey)) {
      const cached = cacheRef.current.get(cacheKey)!;
      setData(cached);
      setIsCachedHit(true);
      setLoading(false);
      setError(null);
      return;
    }

    // Cancel any previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setIsCachedHit(false);
    setError(null);

    try {
      const res = await fetch('/api/reports/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, reportType, quarter, method, month }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'فشل استدعاء التقرير');
      }

      const json: ReportData = await res.json();
      cacheRef.current.set(cacheKey, json);
      setData(json);
      setCurrentPage(1);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Aborted gracefully on fast user switching, ignore
        return;
      }
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [account, reportType, quarter, month, method]);

  // Auto trigger report fetch when inputs change (fluid and responsive)
  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const handleGenerateInsurance = async (targetMonth: number) => {
    setGenerateLoading(true);
    setDeleteResult(null);
    try {
      const res = await fetch('/api/insurance/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_year: 2026, period_month: targetMonth, default_wage: 5385 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل توليد التأمينات');
      setDeleteResult({ success: json.message });
      // Invalidate cache
      cacheRef.current.clear();
      fetchImportLogs();
      fetchReport(true);
    } catch (err: unknown) {
      setDeleteResult({ error: err instanceof Error ? err.message : 'فشل توليد التأمينات' });
    } finally {
      setGenerateLoading(false);
    }
  };

  // Quick select month from status cards
  const handleSelectMonthQuick = (mNum: number) => {
    setMonth(mNum);
    // If current report is quarter-based, also switch quarter to match
    if (mNum >= 1 && mNum <= 3) setQuarter('Q1');
    else if (mNum >= 4 && mNum <= 6) setQuarter('Q2');
    else if (mNum >= 7 && mNum <= 9) setQuarter('Q3');
    else if (mNum >= 10 && mNum <= 12) setQuarter('Q4');
  };

  const [exportingData, setExportingData] = useState(false);
  const [exportingTemplate, setExportingTemplate] = useState(false);

  // In-place download without opening about:blank or any blank tabs
  const triggerInPlaceDownload = async (url: string, defaultFilename: string, setLoadingState: (b: boolean) => void) => {
    setLoadingState(true);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || 'فشل تحميل الملف من الخادم');
      }

      // Read Content-Disposition header if available
      let filename = defaultFilename;
      const disposition = res.headers.get('content-disposition');
      if (disposition) {
        const match = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
        if (match && match[1]) {
          filename = decodeURIComponent(match[1].replace(/["']/g, ''));
        }
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل الملف');
    } finally {
      setLoadingState(false);
    }
  };

  // Export handlers (direct seamless in-place download)
  const handleExportData = () => {
    const url = `/api/reports/export?action=data&account=${account}&reportType=${reportType}&quarter=${quarter}&method=${method}&month=${month}`;
    const defaultFilename = reportType === 'insurance_invoice'
      ? `Insurance_Invoice_${account}_Month_${month}.xlsx`
      : `${reportType}_${account}_${quarter}.xlsx`;
    triggerInPlaceDownload(url, defaultFilename, setExportingData);
  };

  const handleExportTemplate = () => {
    const url = `/api/reports/export?action=template&account=${account}&reportType=${reportType}`;
    const defaultFilename = `Template_${reportType}_${account}.xlsx`;
    triggerInPlaceDownload(url, defaultFilename, setExportingTemplate);
  };

  // Delete handler
  const handleDeleteConfirm = async () => {
    if (!deleteModal) return;
    setDeleteLoading(true);
    setDeleteResult(null);
    try {
      const res = await fetch('/api/import/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_type: deleteModal.sourceType,
          period_year: deleteModal.year,
          period_month: deleteModal.month,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDeleteResult({ success: json.message });
      setDeleteModal(null);
      // Invalidate cache
      cacheRef.current.clear();
      fetchImportLogs(); // refresh logs
      fetchReport(true);
    } catch (err: unknown) {
      setDeleteResult({ error: err instanceof Error ? err.message : 'فشل الحذف' });
    } finally {
      setDeleteLoading(false);
    }
  };

  // Filtered rows
  const filteredRows = useMemo(() => {
    if (!data || !data.rows) return [];
    if (!searchQuery.trim()) return data.rows;
    const q = searchQuery.toLowerCase().trim();
    return data.rows.filter((row) => {
      const name = String(row.name || '').toLowerCase();
      const code = String(row.code || '').toLowerCase();
      const nid = String(row.nid || '').toLowerCase();
      const job = String(row.jobTitle || '').toLowerCase();
      const dept = String(row.department || '').toLowerCase();
      return (
        name.includes(q) ||
        code.includes(q) ||
        nid.includes(q) ||
        job.includes(q) ||
        dept.includes(q)
      );
    });
  }, [data, searchQuery]);

  const totalPages = Math.ceil(filteredRows.length / rowsPerPage) || 1;
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredRows.slice(start, start + rowsPerPage);
  }, [filteredRows, currentPage]);

  return (
    <div style={{ minHeight: '100vh', background: '#080d1a', color: '#f1f5f9' }} dir="rtl">
      <Navbar />

      <main style={{ width: '94%', maxWidth: 1800, margin: '2rem auto', padding: '0 1rem' }}>
        {/* ── Top Header Banner ── */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'linear-gradient(135deg, #4f46e5, #06b6d4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 8px 24px rgba(79, 70, 229, 0.35)',
                }}>
                  <FileSpreadsheet style={{ width: 24, height: 24, color: '#fff' }} />
                </div>
                <div>
                  <h1 style={{ fontSize: '1.6rem', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
                    مركز التقارير والاستدعاء وقوالب الشيتات الذكية
                  </h1>
                  <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                    استخراج وتحليل وتصدير تقارير الأجور والـ HR Letter والمطابقة القانونية لعام 2026
                  </span>
                </div>
              </div>
            </div>

            {/* Badges */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '6px 14px', borderRadius: '9999px',
                background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#34d399', fontSize: '0.82rem', fontWeight: 700,
              }}>
                <ShieldCheck style={{ width: 16, height: 16 }} />
                مطابق لقانون العمل والتأمينات 2026
              </div>

              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '6px 14px', borderRadius: '9999px',
                background: 'rgba(99, 102, 241, 0.12)', border: '1px solid rgba(99, 102, 241, 0.3)',
                color: '#818cf8', fontSize: '0.82rem', fontWeight: 700,
              }}>
                <Building2 style={{ width: 16, height: 16 }} />
                عزل تام للأكونتات (E.G / m.g)
              </div>
            </div>
          </div>
        </div>

        {/* ── Available Months Status Strip ── */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(148, 163, 184, 0.12)',
          borderRadius: 16,
          padding: '1.25rem 1.5rem',
          marginBottom: '1.5rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
            <DatabaseZap style={{ width: 18, height: 18, color: '#38bdf8' }} />
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f1f5f9' }}>
              حالة الشيتات المتوفرة في قاعدة البيانات (2026)
            </span>
            <span style={{ fontSize: '0.75rem', color: '#64748b', marginRight: 4 }}>
              {logsLoading ? 'جاري التحميل...' : ''}
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {Object.keys(MONTH_NAMES).map((mStr) => {
              const mNum = Number(mStr);
              const status = monthlyStatus[mNum];
              const hasPayroll = status?.payroll;
              const hasInsurance = status?.insurance;
              const isFull = hasPayroll && hasInsurance;
              const isEmpty = !hasPayroll && !hasInsurance;
              const isSelected = month === mNum;

              const bgColor = isSelected
                ? 'rgba(56, 189, 248, 0.2)'
                : isFull
                ? 'rgba(16, 185, 129, 0.12)'
                : hasPayroll
                ? 'rgba(245, 158, 11, 0.12)'
                : isEmpty
                ? 'rgba(30, 41, 59, 0.4)'
                : 'rgba(239, 68, 68, 0.08)';

              const borderColor = isSelected
                ? '#38bdf8'
                : isFull
                ? 'rgba(16, 185, 129, 0.35)'
                : hasPayroll
                ? 'rgba(245, 158, 11, 0.35)'
                : isEmpty
                ? 'rgba(148, 163, 184, 0.12)'
                : 'rgba(239, 68, 68, 0.25)';

              return (
                <div
                  key={mNum}
                  onClick={() => handleSelectMonthQuick(mNum)}
                  style={{
                    padding: '8px 14px', borderRadius: 12,
                    background: bgColor, border: `2px solid ${borderColor}`,
                    minWidth: 105, textAlign: 'center', cursor: 'pointer',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    transform: isSelected ? 'scale(1.04)' : 'scale(1)',
                    boxShadow: isSelected ? '0 0 16px rgba(56, 189, 248, 0.4)' : 'none',
                    position: 'relative',
                  }}
                  title={`انقر لتحديد شهر ${MONTH_NAMES[mNum]} كفترة نشطة في المعاينة`}
                >
                  {isSelected && (
                    <span style={{
                      position: 'absolute', top: -7, right: -5,
                      background: '#38bdf8', color: '#04101e',
                      fontSize: '0.62rem', fontWeight: 800, padding: '1px 5px',
                      borderRadius: 9999, boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
                    }}>
                      نشط 🎯
                    </span>
                  )}
                  <div style={{ fontSize: '0.82rem', fontWeight: 800, color: isSelected ? '#38bdf8' : '#f1f5f9', marginBottom: 4 }}>
                    {MONTH_NAMES[mNum]}
                  </div>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: '0.68rem', padding: '2px 6px', borderRadius: 6,
                      background: hasPayroll ? 'rgba(16, 185, 129, 0.25)' : 'rgba(100, 116, 139, 0.2)',
                      color: hasPayroll ? '#34d399' : '#64748b', fontWeight: 700,
                    }}>
                      {hasPayroll ? '✓ مرتبات' : '— مرتبات'}
                    </span>
                    <span style={{
                      fontSize: '0.68rem', padding: '2px 6px', borderRadius: 6,
                      background: hasInsurance ? 'rgba(99, 102, 241, 0.25)' : 'rgba(100, 116, 139, 0.2)',
                      color: hasInsurance ? '#818cf8' : '#64748b', fontWeight: 700,
                    }}>
                      {hasInsurance ? '✓ تأمينات' : '— تأمينات'}
                    </span>
                  </div>
                  {/* Delete / Generate Buttons inside Month Card */}
                  {(hasPayroll || hasInsurance) && (
                    <div
                      style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 6, flexWrap: 'wrap' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {hasPayroll && (
                        <button
                          onClick={() => setDeleteModal({
                            open: true, sourceType: 'monthly_payroll',
                            month: mNum, year: 2026,
                            label: `مرتبات ${MONTH_NAMES[mNum]} 2026`,
                          })}
                          title={`حذف شيت مرتبات ${MONTH_NAMES[mNum]}`}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 2,
                            padding: '2px 6px', borderRadius: 6, border: '1px solid rgba(239, 68, 68, 0.3)',
                            background: 'rgba(239, 68, 68, 0.1)', color: '#f87171',
                            cursor: 'pointer', fontSize: '0.62rem', fontWeight: 700,
                          }}
                        >
                          <Trash2 style={{ width: 10, height: 10 }} />
                          مرتبات
                        </button>
                      )}
                      {hasInsurance && (
                        <button
                          onClick={() => setDeleteModal({
                            open: true, sourceType: 'monthly_insurance',
                            month: mNum, year: 2026,
                            label: `تأمينات ${MONTH_NAMES[mNum]} 2026`,
                          })}
                          title={`حذف شيت تأمينات ${MONTH_NAMES[mNum]}`}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 2,
                            padding: '2px 6px', borderRadius: 6, border: '1px solid rgba(239, 68, 68, 0.3)',
                            background: 'rgba(239, 68, 68, 0.1)', color: '#f87171',
                            cursor: 'pointer', fontSize: '0.62rem', fontWeight: 700,
                          }}
                        >
                          <Trash2 style={{ width: 10, height: 10 }} />
                          تأمينات
                        </button>
                      )}
                      {hasPayroll && !hasInsurance && (
                        <button
                          onClick={() => handleGenerateInsurance(mNum)}
                          disabled={generateLoading}
                          title={`توليد شيت تأمينات شهر ${MONTH_NAMES[mNum]} من واقع المرتبات`}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 2,
                            padding: '2px 6px', borderRadius: 6, border: '1px solid rgba(56, 189, 248, 0.4)',
                            background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8',
                            cursor: generateLoading ? 'not-allowed' : 'pointer', fontSize: '0.62rem', fontWeight: 700,
                          }}
                        >
                          <Sparkles style={{ width: 10, height: 10 }} />
                          توليد
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend & Hint */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap', gap: '0.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: '#34d399', display: 'inline-block' }} />
                مرتبات وتأمينات مكتملان
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: '#f59e0b', display: 'inline-block' }} />
                مرتبات فقط (تأمينات لم تُرفع)
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: '#475569', display: 'inline-block' }} />
                لم يُرفع بعد
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#38bdf8', fontWeight: 600 }}>
              <Sparkles style={{ width: 14, height: 14 }} />
              💡 نصيحة ذكية: انقر مباشرة على أي كارت شهر أعلاه للانتقال إليه والمعاينة فوراً
            </div>
          </div>
        </div>

        {/* ── Delete Result Banner ── */}
        {deleteResult && (
          <div style={{
            padding: '1rem 1.5rem', borderRadius: 14, marginBottom: '1.5rem',
            display: 'flex', alignItems: 'center', gap: 10,
            ...(deleteResult.success
              ? { background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#34d399' }
              : { background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171' }),
          }}>
            {deleteResult.success ? <CheckCircle2 style={{ width: 20, height: 20 }} /> : <AlertTriangle style={{ width: 20, height: 20 }} />}
            <span>{deleteResult.success || deleteResult.error}</span>
            <button
              onClick={() => setDeleteResult(null)}
              style={{ marginRight: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.7 }}
            >
              <XCircle style={{ width: 18, height: 18 }} />
            </button>
          </div>
        )}

        {/* ── Dynamic Context-Aware Control Panel Card ── */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(148, 163, 184, 0.15)',
          borderRadius: 20,
          padding: '1.5rem',
          marginBottom: '2rem',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
        }}>
          {/* Header of Filter Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles style={{ width: 18, height: 18, color: '#38bdf8' }} />
              <span style={{ fontWeight: 800, fontSize: '0.98rem', color: '#f8fafc' }}>
                محددات ومعايير الاستدعاء الحي (Smart Adaptive Filters)
              </span>
            </div>

            {/* Live Cache Status Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isCachedHit && !loading && (
                <span style={{
                  fontSize: '0.75rem', fontWeight: 700, padding: '3px 10px', borderRadius: 9999,
                  background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.35)',
                  color: '#34d399', display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  ⚡ معاينة لحظية فورية (Instant 0ms Cache)
                </span>
              )}
              {loading && (
                <span style={{
                  fontSize: '0.75rem', fontWeight: 700, padding: '3px 10px', borderRadius: 9999,
                  background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.35)',
                  color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  <RefreshCw style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} />
                  جاري جلب البيانات بدقة...
                </span>
              )}
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1.25rem',
            marginBottom: '1.5rem',
          }}>
            {/* 1. Account Selector */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>
                <Building2 style={{ width: 16, height: 16, color: '#38bdf8' }} />
                الشركة / الأكونت (Account)
              </label>
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value as 'E.G' | 'm.g' | 'ALL')}
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 12,
                  background: 'rgba(30, 41, 59, 0.85)', border: '1px solid rgba(56, 189, 248, 0.35)',
                  color: '#fff', fontSize: '0.9rem', fontWeight: 700, outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="E.G">🏢 Egypt Gas (E.G) - غاز مصر</option>
                <option value="m.g">🏢 Modern Gas (m.g) - مودرن جاز</option>
                <option value="ALL">🌐 جميع الحسابات المدمجة (ALL Accounts)</option>
              </select>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 4, paddingRight: 4 }}>
                عزل تام وتصفية مخصصة لسجلات موظفي الشركة
              </div>
            </div>

            {/* 2. Report Type Selector */}
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>
                <Layers style={{ width: 16, height: 16, color: '#818cf8' }} />
                نوع التقرير المطلوب
              </label>
              <select
                value={reportType}
                onChange={(e) => {
                  const newType = e.target.value;
                  setReportType(newType);
                  // Contextual Smart Defaulting for Period if needed
                  const cfg = REPORT_CONFIGS[newType];
                  if (cfg?.recommendedPeriod) {
                    if (typeof cfg.recommendedPeriod === 'string') {
                      setQuarter(cfg.recommendedPeriod);
                    } else if (typeof cfg.recommendedPeriod === 'number') {
                      setMonth(cfg.recommendedPeriod);
                    }
                  }
                }}
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: 12,
                  background: 'rgba(30, 41, 59, 0.85)', border: '1px solid rgba(129, 140, 248, 0.35)',
                  color: '#fff', fontSize: '0.9rem', fontWeight: 700, outline: 'none',
                  cursor: 'pointer',
                }}
              >
                {Object.entries(REPORT_CONFIGS).map(([val, cfg]) => (
                  <option key={val} value={val}>
                    {cfg.label}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: '0.72rem', color: '#a5b4fc', marginTop: 4, paddingRight: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentConfig.description}
              </div>
            </div>

            {/* 3. Dynamic Period Selector (Adapts automatically based on report type) */}
            {currentConfig.periodType === 'month' ? (
              /* Month Selector with Live Completion Badges */
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>
                  <Calendar style={{ width: 16, height: 16, color: '#38bdf8' }} />
                  شهر الفاتورة التأمينية
                </label>
                <select
                  value={month}
                  onChange={(e) => setMonth(Number(e.target.value))}
                  style={{
                    width: '100%', padding: '11px 14px', borderRadius: 12,
                    background: 'rgba(30, 41, 59, 0.85)', border: '1px solid rgba(56, 189, 248, 0.4)',
                    color: '#fff', fontSize: '0.9rem', fontWeight: 700, outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {[9, 8, 7, 6, 5, 4, 3, 2, 1, 10, 11, 12].map((m) => {
                    const status = monthlyStatus[m];
                    const hasBoth = status?.payroll && status?.insurance;
                    const hasOnly = status?.payroll || status?.insurance;
                    const icon = hasBoth ? '🟢' : hasOnly ? '🟡' : '⚪';
                    const stateText = hasBoth ? 'مكتمل (مرتبات وتأمينات)' : hasOnly ? 'مرتبات فقط' : 'لم يُرفع بعد';
                    return (
                      <option key={m} value={m}>
                        {icon} شهر {m} ({MONTH_NAMES[m]} 2026) — {stateText}
                      </option>
                    );
                  })}
                </select>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 4, paddingRight: 4 }}>
                  حالة الشهر المختار: {monthlyStatus[month]?.insurance ? '✅ التأمينات متوفرة ومطابقة' : '⚠️ شيت التأمينات يحتاج توليد أو رفع'}
                </div>
              </div>
            ) : currentConfig.periodType === 'quarter' ? (
              /* Quarter Selector with Live Data Detection */
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>
                  <Calendar style={{ width: 16, height: 16, color: '#34d399' }} />
                  الفترة / الربع السنوي
                </label>
                <select
                  value={quarter}
                  onChange={(e) => setQuarter(e.target.value)}
                  style={{
                    width: '100%', padding: '11px 14px', borderRadius: 12,
                    background: 'rgba(30, 41, 59, 0.85)', border: '1px solid rgba(52, 211, 153, 0.4)',
                    color: '#fff', fontSize: '0.9rem', fontWeight: 700, outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="Q3">
                    {quarterStatus.Q3.hasData ? '🟢' : '⚪'} الربع الثالث (شهر 7، 8، 9) 👈 الحالي {quarterStatus.Q3.hasData ? `(${quarterStatus.Q3.payrollMonths} أشهر متاحة)` : ''}
                  </option>
                  <option value="Q2">
                    {quarterStatus.Q2.hasData ? '🟢' : '⚪'} الربع الثاني (شهر 4، 5، 6) {quarterStatus.Q2.hasData ? `(${quarterStatus.Q2.payrollMonths} أشهر متاحة)` : '(لا توجد بيانات)'}
                  </option>
                  <option value="Q1">
                    {quarterStatus.Q1.hasData ? '🟢' : '⚪'} الربع الأول (شهر 1، 2، 3) {quarterStatus.Q1.hasData ? `(${quarterStatus.Q1.payrollMonths} أشهر متاحة)` : '(لا توجد بيانات)'}
                  </option>
                  <option value="Q4">
                    {quarterStatus.Q4.hasData ? '🟢' : '⚪'} الربع الرابع (شهر 10، 11، 12) {quarterStatus.Q4.hasData ? `(${quarterStatus.Q4.payrollMonths} أشهر متاحة)` : '(لا توجد بيانات)'}
                  </option>
                  <option value="ANNUAL">
                    📊 تقرير سنوي شامل لكامل العام (12 شهراً)
                  </option>
                </select>
                <div style={{ fontSize: '0.72rem', color: '#6ee7b7', marginTop: 4, paddingRight: 4 }}>
                  {quarter === 'Q3' ? 'يشمل شهور (يوليو، أغسطس، سبتمبر 2026)' : `الفترة المحددة: ${quarter}`}
                </div>
              </div>
            ) : (
              /* Scope Notice for Reports that don't need quarter or month filter */
              <div style={{
                background: 'rgba(30, 41, 59, 0.4)', borderRadius: 12,
                border: '1px dashed rgba(148, 163, 184, 0.25)', padding: '10px 14px',
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
              }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#38bdf8' }}>
                  🎯 نطاق الاستدعاء التلقائي
                </span>
                <span style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: 2 }}>
                  يتم مسح ومطابقة كافة سجلات الاستقالة المسجلة وتوريد استمارة 6 تلقائياً للحساب
                </span>
              </div>
            )}

            {/* 4. Adaptive Calculation Method (Only visible for HR Letter & wage average reports!) */}
            {currentConfig.showMethod && (
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>
                  <TrendingUp style={{ width: 16, height: 16, color: '#f59e0b' }} />
                  طريقة حساب المتوسط
                </label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  style={{
                    width: '100%', padding: '11px 14px', borderRadius: 12,
                    background: 'rgba(30, 41, 59, 0.85)', border: '1px solid rgba(245, 158, 11, 0.4)',
                    color: '#fff', fontSize: '0.9rem', fontWeight: 700, outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="actual">شهور العمل الفعلية (موصى به للـ HR Letter لمنع ظلم الموظف)</option>
                  <option value="divided_by_3">قسمة صارمة على 3 (موازنة الربع المحاسبية)</option>
                </select>
                <div style={{ fontSize: '0.72rem', color: '#fbbf24', marginTop: 4, paddingRight: 4 }}>
                  {method === 'actual' ? 'يقسم على عدد الشهور التي عمل بها الموظف فعلياً' : 'يقسم المجموع دائماً على 3 حتى لو عمل شهراً واحداً'}
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
            paddingTop: '1.25rem',
            borderTop: '1px solid rgba(148, 163, 184, 0.12)',
          }}>
            {/* Refresh / Call Report Button */}
            <button
              onClick={() => fetchReport(true)}
              disabled={loading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '11px 24px', borderRadius: 12,
                background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
                border: 'none', color: '#fff', fontSize: '0.92rem', fontWeight: 800,
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 18px rgba(79, 70, 229, 0.4)',
                opacity: loading ? 0.7 : 1,
                transition: 'all 0.2s',
              }}
              title="إعادة جلب التقرير وتحديث الذاكرة المؤقتة"
            >
              <RefreshCw style={{ width: 18, height: 18, animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              {loading ? 'جاري الاستدعاء...' : 'استدعاء ومعاينة التقرير'}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {/* Contextual Smart Generate Insurance Button: Only shown if relevant or insurance missing */}
              {reportType === 'insurance_invoice' && !monthlyStatus[month]?.insurance && (
                <button
                  onClick={() => handleGenerateInsurance(month)}
                  disabled={generateLoading}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '11px 18px', borderRadius: 12,
                    background: 'linear-gradient(135deg, #0284c7, #38bdf8)',
                    border: 'none', color: '#fff', fontSize: '0.88rem', fontWeight: 800,
                    cursor: generateLoading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 16px rgba(56, 189, 248, 0.35)',
                    opacity: generateLoading ? 0.7 : 1,
                    animation: 'pulse 2s infinite',
                  }}
                  title={`توليد وحفظ شيت تأمينات شهر ${MONTH_NAMES[month]} من واقع كشف المرتبات وتاريخ التأمينات`}
                >
                  <Sparkles style={{ width: 18, height: 18, animation: generateLoading ? 'spin 1s linear infinite' : 'none' }} />
                  {generateLoading ? 'جاري التوليد...' : `⚡ توليد تأمينات ${MONTH_NAMES[month]}`}
                </button>
              )}

              {/* Export Populated Excel */}
              <button
                onClick={handleExportData}
                disabled={exportingData}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '11px 20px', borderRadius: 12,
                  background: 'linear-gradient(135deg, #059669, #10b981)',
                  border: 'none', color: '#fff', fontSize: '0.88rem', fontWeight: 800,
                  cursor: exportingData ? 'not-allowed' : 'pointer',
                  opacity: exportingData ? 0.7 : 1,
                  boxShadow: '0 4px 16px rgba(16, 185, 129, 0.35)',
                  transition: 'all 0.2s',
                }}
              >
                <Download style={{ width: 18, height: 18, animation: exportingData ? 'spin 1s linear infinite' : 'none' }} />
                {exportingData ? 'جاري تصدير التقرير وتحميله...' : 'تصدير التقرير الفعلي Excel (.xlsx)'}
              </button>

              {/* Export Blank Template */}
              <button
                onClick={handleExportTemplate}
                disabled={exportingTemplate}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '11px 18px', borderRadius: 12,
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  color: '#38bdf8', fontSize: '0.88rem', fontWeight: 700,
                  cursor: exportingTemplate ? 'not-allowed' : 'pointer',
                  opacity: exportingTemplate ? 0.7 : 1,
                  transition: 'all 0.2s',
                }}
                title="تصدير شيت فارغ برؤوس الأعمدة الرسمية لإدخال البيانات فيه"
              >
                <FileDown style={{ width: 18, height: 18, animation: exportingTemplate ? 'spin 1s linear infinite' : 'none' }} />
                {exportingTemplate ? 'جاري تصدير القالب...' : 'تصدير شيت قالب فارغ (Template)'}
              </button>
            </div>
          </div>
        </div>

        {/* ── KPI Summary Cards ── */}
        {data && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            {/* Total Employees */}
            <div style={{ padding: '1.25rem', borderRadius: 16, background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(148, 163, 184, 0.1)' }}>
              <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>إجمالي موظفي الحساب</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f8fafc' }}>
                {data.summary.totalEmployees.toLocaleString('en-US')}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#38bdf8', marginTop: 4 }}>
                نشط في الفترة: {data.summary.activeInPeriod.toLocaleString('en-US')}
              </div>
            </div>

            {/* Average Wage */}
            <div style={{ padding: '1.25rem', borderRadius: 16, background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(148, 163, 184, 0.1)' }}>
              <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>متوسط الأجر الشهري</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10b981' }}>
                {data.summary.avgWage.toLocaleString('en-US')} ج.م
              </div>
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: 4 }}>
                إجمالي مسير الرواتب: {(data.summary.totalPayroll / 1000000).toFixed(2)} مليون ج.م
              </div>
            </div>

            {/* Employer Insurance Contribution (18.75%) */}
            <div style={{ padding: '1.25rem', borderRadius: 16, background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(148, 163, 184, 0.1)' }}>
              <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>حصة الشركة في التأمينات (18.75%)</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#818cf8' }}>
                {data.summary.totalEmployerInsurance.toLocaleString('en-US')} ج.م
              </div>
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: 4 }}>
                تكلفة شهرية مباشرة على الشركة
              </div>
            </div>

            {/* Min Wage Compliance (7,000 EGP) */}
            <div style={{ padding: '1.25rem', borderRadius: 16, background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(148, 163, 184, 0.1)' }}>
              <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>الالتزام بالحد الأدنى (7,000 ج.م)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#34d399' }}>
                  {data.summary.minWageComplianceCount.toLocaleString('en-US')}
                </span>
                <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>موظف مطابق</span>
              </div>
              {data.summary.warningsCount > 0 && (
                <div style={{ fontSize: '0.78rem', color: '#f87171', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle style={{ width: 13, height: 13 }} />
                  {data.summary.warningsCount} حالة بحاجة لتدقيق/مراجعة
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Error Banner ── */}
        {error && (
          <div style={{
            padding: '1rem 1.5rem', borderRadius: 14,
            background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#f87171', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <AlertTriangle style={{ width: 20, height: 20 }} />
            <span>{error}</span>
          </div>
        )}

        {/* ── Table Section ── */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.75)',
          border: '1px solid rgba(148, 163, 184, 0.12)',
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
        }}>
          {/* Table Header Filter & Mode Switcher Bar */}
          <div style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid rgba(148, 163, 184, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {/* Title Badge */}
              <span style={{ fontWeight: 800, fontSize: '1rem', color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileSpreadsheet style={{ width: 18, height: 18, color: '#38bdf8' }} />
                {data ? data.reportTitle : 'جاري التحميل...'}
                <span style={{ fontSize: '0.78rem', fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                  {filteredRows.length.toLocaleString('en-US')} موظف
                </span>
              </span>

              {/* Worked months info badge */}
              {reportType === 'hr_letter' && data && (
                <span style={{
                  fontSize: '0.72rem', fontWeight: 700, padding: '2px 10px',
                  borderRadius: 9999, background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <Sparkles style={{ width: 12, height: 12 }} />
                  عمود &quot;عدد أشهر العمل&quot; يُبيّن الشهور الفعلية للمتوسط
                </span>
              )}
            </div>

            {/* Search Box */}
            <div style={{ position: 'relative', width: 320 }}>
              <Search style={{ position: 'absolute', right: 12, top: 10, width: 18, height: 18, color: '#64748b' }} />
              <input
                type="text"
                placeholder="بحث بالكود، الاسم، الرقم القومي، الوظيفة..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                style={{
                  width: '100%', padding: '9px 38px 9px 12px', borderRadius: 10,
                  background: 'rgba(30, 41, 59, 0.8)', border: '1px solid rgba(148, 163, 184, 0.2)',
                  color: '#fff', fontSize: '0.88rem', outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Detailed Table with Sticky Grand Total Row in TFOOT */}
          <div style={{ overflowX: 'auto', maxHeight: '600px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.85rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#0d1527', zIndex: 10 }}>
                    <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.15)' }}>
                      <th style={{ padding: '12px 16px', color: '#94a3b8', fontWeight: 700 }}>#</th>
                      {data?.columns.map((col) => (
                        <th key={col.key} style={{
                          padding: '12px 16px', color: '#94a3b8', fontWeight: 700, whiteSpace: 'nowrap',
                          ...(col.key === 'workedMonthsInQuarter' ? { color: '#fbbf24' } : {}),
                        }}>
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.length > 0 ? (
                      paginatedRows.map((row, idx) => {
                        const rowNum = (currentPage - 1) * rowsPerPage + idx + 1;
                        return (
                          <tr
                            key={idx}
                            style={{
                              borderBottom: '1px solid rgba(148, 163, 184, 0.05)',
                              background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)',
                              transition: 'background 0.15s',
                            }}
                          >
                            <td style={{ padding: '11px 16px', color: '#64748b' }}>{rowNum}</td>
                            {data?.columns.map((col) => {
                              const val = row[col.key];
                              const strVal = val !== undefined && val !== null ? String(val) : '';
                              const isWarning = strVal.includes('⚠️');
                              const isSuccess = strVal.includes('✅');
                              const isMonthsCol = col.key === 'workedMonthsInQuarter';

                              return (
                                <td
                                  key={col.key}
                                  style={{
                                    padding: '11px 16px',
                                    color: isWarning ? '#f87171' : isSuccess ? '#34d399' : isMonthsCol ? '#fbbf24' : '#cbd5e1',
                                    whiteSpace: 'nowrap',
                                    fontWeight: isMonthsCol ? 600 : 400,
                                  }}
                                >
                                  {strVal}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan={(data?.columns.length || 0) + 1}
                          style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}
                        >
                          {loading ? 'جاري جلب وتجميع السجلات...' : 'لا توجد بيانات مطابقة لمعايير البحث الحالية'}
                        </td>
                      </tr>
                    )}
                  </tbody>

                  {/* ── Grand Summary Total Row at the End of the Sheet ── */}
                  {data && data.summaryRow && (
                    <tfoot style={{ position: 'sticky', bottom: 0, background: '#0a1020', zIndex: 10, borderTop: '2px solid rgba(56, 189, 248, 0.4)' }}>
                      <tr style={{ background: 'rgba(15, 23, 42, 0.98)', boxShadow: '0 -4px 14px rgba(0,0,0,0.4)' }}>
                        <td style={{ padding: '13px 16px', color: '#38bdf8', fontWeight: 800 }}>∑</td>
                        {data.columns.map((col) => {
                          const val = data.summaryRow[col.key];
                          const strVal = val !== undefined && val !== null && String(val).trim() !== '' ? String(val) : '';
                          const isNumericVal = /^[0-9.,]+$/.test(strVal);
                          return (
                            <td
                              key={col.key}
                              style={{
                                padding: '13px 16px',
                                color: isNumericVal ? '#34d399' : '#38bdf8',
                                fontWeight: 800,
                                whiteSpace: 'nowrap',
                                fontSize: '0.88rem',
                              }}
                            >
                              {strVal}
                            </td>
                          );
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Table Footer Pagination */}
              {totalPages > 1 && (
                <div style={{
                  padding: '1rem 1.5rem',
                  borderTop: '1px solid rgba(148, 163, 184, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                    عرض صفحة {currentPage} من {totalPages}
                  </span>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      style={{
                        padding: '6px 14px', borderRadius: 8,
                        background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(148, 163, 184, 0.15)',
                        color: currentPage <= 1 ? '#475569' : '#cbd5e1',
                        cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
                        fontSize: '0.82rem', fontWeight: 600,
                      }}
                    >
                      السابق
                    </button>
                    <button
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      style={{
                        padding: '6px 14px', borderRadius: 8,
                        background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(148, 163, 184, 0.15)',
                        color: currentPage >= totalPages ? '#475569' : '#cbd5e1',
                        cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
                        fontSize: '0.82rem', fontWeight: 600,
                      }}
                    >
                      التالي
                    </button>
                  </div>
                </div>
              )}

          {/* ── Previous Month Comparison & Variance Table (تقرير مقارنة الفاتورة التأمينية بالشهر السابق) ── */}
          {data?.monthComparison && (
            <div style={{
              margin: '1.5rem',
              padding: '1.5rem',
              background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.95), rgba(13, 21, 39, 0.98))',
              borderRadius: 16,
              border: '1px solid rgba(56, 189, 248, 0.25)',
              boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(99, 102, 241, 0.2))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                  }}>
                    <Scale style={{ width: 22, height: 22, color: '#38bdf8' }} />
                  </div>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                      📊 تقرير مقارنة الفاتورة التأمينية بالشهر السابق ورصد الفروقات
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 9999, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8' }}>
                        بنهاية نفس الشيت
                      </span>
                    </h3>
                    <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                      مقارنة حركة عمالة وتأمينات شهر {data.monthComparison.currentMonthName} 2026 مع شهر {data.monthComparison.previousMonthName} 2026
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{
                    padding: '4px 12px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 700,
                    background: data.monthComparison.diffEmployees >= 0 ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: data.monthComparison.diffEmployees >= 0 ? '#4ade80' : '#f87171',
                    border: `1px solid ${data.monthComparison.diffEmployees >= 0 ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                  }}>
                    العمالة: {data.monthComparison.diffEmployees >= 0 ? `+${data.monthComparison.diffEmployees}` : data.monthComparison.diffEmployees} موظف
                  </span>
                  <span style={{
                    padding: '4px 12px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 700,
                    background: data.monthComparison.diffTotal2975 >= 0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                    color: data.monthComparison.diffTotal2975 >= 0 ? '#38bdf8' : '#fbbf24',
                    border: `1px solid ${data.monthComparison.diffTotal2975 >= 0 ? 'rgba(56, 189, 248, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
                  }}>
                    فارق المطالبة (29.75%): {data.monthComparison.diffTotal2975 >= 0 ? `+${data.monthComparison.diffTotal2975.toLocaleString('en-US')}` : data.monthComparison.diffTotal2975.toLocaleString('en-US')} ج.م
                  </span>
                </div>
              </div>

              {/* Comparison Table */}
              <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid rgba(148, 163, 184, 0.15)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(30, 41, 59, 0.8)', borderBottom: '1px solid rgba(148, 163, 184, 0.2)' }}>
                      <th style={{ padding: '10px 14px', color: '#94a3b8', fontWeight: 700 }}>بيان المقارنة الفنية والمالية</th>
                      <th style={{ padding: '10px 14px', color: '#cbd5e1', fontWeight: 700 }}>الشهر السابق ({data.monthComparison.previousMonthName})</th>
                      <th style={{ padding: '10px 14px', color: '#38bdf8', fontWeight: 700 }}>الشهر الحالي ({data.monthComparison.currentMonthName})</th>
                      <th style={{ padding: '10px 14px', color: '#f59e0b', fontWeight: 700 }}>الفارق / التغير (+ / -)</th>
                      <th style={{ padding: '10px 14px', color: '#94a3b8', fontWeight: 700 }}>الملاحظات ودلالة التغير</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.08)' }}>
                      <td style={{ padding: '10px 14px', color: '#f1f5f9', fontWeight: 600 }}>عدد العاملين المسجلين بالتأمينات</td>
                      <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                        {data.monthComparison.hasPreviousData ? `${data.monthComparison.previousEmployees.toLocaleString('en-US')} موظف` : 'غير متوفر'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#38bdf8', fontWeight: 700 }}>
                        {data.monthComparison.currentEmployees.toLocaleString('en-US')} موظف
                      </td>
                      <td style={{
                        padding: '10px 14px', fontWeight: 700,
                        color: data.monthComparison.diffEmployees >= 0 ? '#4ade80' : '#f87171'
                      }}>
                        {data.monthComparison.hasPreviousData ? (data.monthComparison.diffEmployees >= 0 ? `+${data.monthComparison.diffEmployees}` : data.monthComparison.diffEmployees) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {data.monthComparison.hasPreviousData
                          ? (data.monthComparison.diffEmployees >= 0 ? `زيادة صافية في العمالة (+${data.monthComparison.diffEmployees} موظف)` : `انخفاض في العمالة (${data.monthComparison.diffEmployees} موظف)`)
                          : 'لا توجد بيانات سابقة للمقارنة'}
                      </td>
                    </tr>

                    <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.08)' }}>
                      <td style={{ padding: '10px 14px', color: '#f1f5f9', fontWeight: 600 }}>إجمالي الأجر التأميني (ج.م)</td>
                      <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                        {data.monthComparison.hasPreviousData ? `${data.monthComparison.previousInsWage.toLocaleString('en-US')} ج.م` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#818cf8', fontWeight: 700 }}>
                        {data.monthComparison.currentInsWage.toLocaleString('en-US')} ج.م
                      </td>
                      <td style={{
                        padding: '10px 14px', fontWeight: 700,
                        color: data.monthComparison.diffInsWage >= 0 ? '#4ade80' : '#f87171'
                      }}>
                        {data.monthComparison.hasPreviousData ? (data.monthComparison.diffInsWage >= 0 ? `+${data.monthComparison.diffInsWage.toLocaleString('en-US')}` : data.monthComparison.diffInsWage.toLocaleString('en-US')) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {data.monthComparison.hasPreviousData
                          ? (data.monthComparison.diffInsWage >= 0 ? `زيادة في كتلة الأجور التأمينية` : `انخفاض في كتلة الأجور`)
                          : '—'}
                      </td>
                    </tr>

                    <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.08)' }}>
                      <td style={{ padding: '10px 14px', color: '#f1f5f9', fontWeight: 600 }}>حصة صاحب العمل (18.75%)</td>
                      <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                        {data.monthComparison.hasPreviousData ? `${data.monthComparison.previousEmployer1875.toLocaleString('en-US')} ج.م` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#38bdf8', fontWeight: 700 }}>
                        {data.monthComparison.currentEmployer1875.toLocaleString('en-US')} ج.م
                      </td>
                      <td style={{
                        padding: '10px 14px', fontWeight: 700,
                        color: data.monthComparison.diffEmployer1875 >= 0 ? '#4ade80' : '#f87171'
                      }}>
                        {data.monthComparison.hasPreviousData ? (data.monthComparison.diffEmployer1875 >= 0 ? `+${data.monthComparison.diffEmployer1875.toLocaleString('en-US')}` : data.monthComparison.diffEmployer1875.toLocaleString('en-US')) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {data.monthComparison.hasPreviousData
                          ? (data.monthComparison.diffEmployer1875 >= 0 ? `زيادة في التزام الشركة الشهري` : `انخفاض في التزام الشركة`)
                          : '—'}
                      </td>
                    </tr>

                    <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.08)' }}>
                      <td style={{ padding: '10px 14px', color: '#f1f5f9', fontWeight: 600 }}>حصة العامل المستقطعة (11%)</td>
                      <td style={{ padding: '10px 14px', color: '#94a3b8' }}>
                        {data.monthComparison.hasPreviousData ? `${data.monthComparison.previousWorker11.toLocaleString('en-US')} ج.م` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#cbd5e1', fontWeight: 700 }}>
                        {data.monthComparison.currentWorker11.toLocaleString('en-US')} ج.م
                      </td>
                      <td style={{
                        padding: '10px 14px', fontWeight: 700,
                        color: data.monthComparison.diffWorker11 >= 0 ? '#4ade80' : '#f87171'
                      }}>
                        {data.monthComparison.hasPreviousData ? (data.monthComparison.diffWorker11 >= 0 ? `+${data.monthComparison.diffWorker11.toLocaleString('en-US')}` : data.monthComparison.diffWorker11.toLocaleString('en-US')) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>
                        {data.monthComparison.hasPreviousData
                          ? (data.monthComparison.diffWorker11 >= 0 ? `زيادة استقطاعات العاملين` : `انخفاض استقطاعات العاملين`)
                          : '—'}
                      </td>
                    </tr>

                    <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.08)', background: 'rgba(56, 189, 248, 0.05)' }}>
                      <td style={{ padding: '10px 14px', color: '#38bdf8', fontWeight: 800 }}>إجمالي المطالبة التأمينية (29.75%)</td>
                      <td style={{ padding: '10px 14px', color: '#94a3b8', fontWeight: 700 }}>
                        {data.monthComparison.hasPreviousData ? `${data.monthComparison.previousTotal2975.toLocaleString('en-US')} ج.م` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#f59e0b', fontWeight: 800 }}>
                        {data.monthComparison.currentTotal2975.toLocaleString('en-US')} ج.م
                      </td>
                      <td style={{
                        padding: '10px 14px', fontWeight: 800,
                        color: data.monthComparison.diffTotal2975 >= 0 ? '#38bdf8' : '#fbbf24'
                      }}>
                        {data.monthComparison.hasPreviousData ? (data.monthComparison.diffTotal2975 >= 0 ? `+${data.monthComparison.diffTotal2975.toLocaleString('en-US')}` : data.monthComparison.diffTotal2975.toLocaleString('en-US')) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#38bdf8', fontWeight: 600 }}>
                        {data.monthComparison.hasPreviousData
                          ? (data.monthComparison.diffTotal2975 >= 0 ? `صافي الفارق بالزيادة في إجمالي الشيك/المطالبة` : `صافي الفارق بالنقص في إجمالي الشيك/المطالبة`)
                          : '—'}
                      </td>
                    </tr>

                    <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.08)' }}>
                      <td style={{ padding: '10px 14px', color: '#4ade80', fontWeight: 600 }}>حركة المعينين الجدد المضافين للتأمينات</td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>—</td>
                      <td style={{ padding: '10px 14px', color: '#4ade80', fontWeight: 700 }}>{data.monthComparison.newHiresCount} موظف جديد</td>
                      <td style={{ padding: '10px 14px', color: '#4ade80', fontWeight: 700 }}>+{data.monthComparison.newHiresCount}</td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>موظفون دخلوا كشف التأمينات هذا الشهر لأول مرة أو بعد انقطاع</td>
                    </tr>

                    <tr>
                      <td style={{ padding: '10px 14px', color: '#f87171', fontWeight: 600 }}>حركة الاستبعادات (المنتهية خدمتهم)</td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>—</td>
                      <td style={{ padding: '10px 14px', color: '#f87171', fontWeight: 700 }}>{data.monthComparison.terminatedCount} موظف مستبعد</td>
                      <td style={{ padding: '10px 14px', color: '#f87171', fontWeight: 700 }}>-{data.monthComparison.terminatedCount}</td>
                      <td style={{ padding: '10px 14px', color: '#64748b' }}>موظفون تواجدوا في الشهر السابق وخرجوا من كشف التأمينات هذا الشهر</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Delete Confirmation Modal ── */}
      {deleteModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '1rem',
        }}>
          <div style={{
            background: '#0f1729',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: 20, padding: '2rem', maxWidth: 480, width: '100%',
            boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: 'rgba(239, 68, 68, 0.15)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Trash2 style={{ width: 22, height: 22, color: '#f87171' }} />
              </div>
              <div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>تأكيد الحذف النهائي</div>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>هذا الإجراء لا يمكن التراجع عنه</div>
              </div>
            </div>

            <div style={{
              padding: '1rem', borderRadius: 12,
              background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
              marginBottom: '1.5rem',
            }}>
              <p style={{ margin: 0, color: '#fca5a5', fontSize: '0.9rem', lineHeight: 1.6 }}>
                هل أنت متأكد من حذف بيانات <strong style={{ color: '#f87171' }}>{deleteModal.label}</strong> بشكل كامل من قاعدة البيانات؟
              </p>
              <p style={{ margin: '0.5rem 0 0', color: '#94a3b8', fontSize: '0.8rem' }}>
                سيتم حذف جميع سجلات هذا الشيت وسجل الاستيراد الخاص به. يمكنك إعادة الاستيراد لاحقاً.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteModal(null)}
                disabled={deleteLoading}
                style={{
                  padding: '10px 20px', borderRadius: 10, border: '1px solid rgba(148, 163, 184, 0.2)',
                  background: 'rgba(255, 255, 255, 0.05)', color: '#94a3b8',
                  cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
                }}
              >
                إلغاء
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleteLoading}
                style={{
                  padding: '10px 22px', borderRadius: 10,
                  background: deleteLoading ? 'rgba(239, 68, 68, 0.4)' : 'linear-gradient(135deg, #dc2626, #ef4444)',
                  border: 'none', color: '#fff',
                  cursor: deleteLoading ? 'not-allowed' : 'pointer',
                  fontWeight: 700, fontSize: '0.9rem',
                  display: 'flex', alignItems: 'center', gap: 8,
                  boxShadow: '0 4px 18px rgba(239, 68, 68, 0.35)',
                }}
              >
                {deleteLoading ? (
                  <>
                    <RefreshCw style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
                    جاري الحذف...
                  </>
                ) : (
                  <>
                    <Trash2 style={{ width: 16, height: 16 }} />
                    نعم، احذف نهائياً
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
