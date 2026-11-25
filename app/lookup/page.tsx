'use client';

import { useState, useEffect, useRef, useTransition, useCallback } from 'react';
import {
  Search, User, Calendar, AlertTriangle, CheckCircle2, XCircle,
  FileText, Clock, Building2, FileSpreadsheet, AlertCircle, Briefcase,
  History, Layers, Copy, Sparkles, ShieldCheck, X, ChevronLeft, Download,
  CreditCard, HeartPulse, FolderCheck, AlertOctagon, HelpCircle, FileCheck, Check,
  Phone, MapPin, Building, Award, ShieldAlert, BadgeCheck, Stethoscope, Landmark
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import * as XLSX from 'xlsx';
import type { SearchCandidate, EmployeeDetailsResult, MonthAvailability } from '@/lib/lookupService';
import UnifiedEmployeeCard from '@/components/UnifiedEmployeeCard';
import EmployeeChecklistPanel from '@/components/EmployeeChecklistPanel';
import SearchOperationsLogPanel from '@/components/SearchOperationsLogPanel';

/* ─── Status helpers ─── */
function getStatusCfg(status: string) {
  if (status === 'موجود في المرتبات والتأمينات')
    return { cardCls: 'status-success', badgeCls: 'badge-emerald', Icon: CheckCircle2, iconColor: '#34d399' };
  if (status.includes('فقط'))
    return { cardCls: 'status-info', badgeCls: 'badge-brand', Icon: FileSpreadsheet, iconColor: '#818cf8' };
  if (status.includes('غير مستورد'))
    return { cardCls: 'status-neutral', badgeCls: 'badge-slate', Icon: AlertCircle, iconColor: '#94a3b8' };
  return { cardCls: 'status-error', badgeCls: 'badge-rose', Icon: XCircle, iconColor: '#fb7185' };
}

/* ─── Copyable data row ─── */
function DataRow({ label, value, mono = false, accent }: {
  label: string; value?: unknown; mono?: boolean; accent?: string;
}) {
  const strVal = value != null ? String(value) : '';
  const [copied, setCopied] = useState(false);
  return (
    <div
      style={{ padding: '14px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.12)', position: 'relative' }}
      className="glass-card-hover"
      onMouseEnter={(e) => {
        const b = e.currentTarget.querySelector<HTMLElement>('.copy-btn');
        if (b) b.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        const b = e.currentTarget.querySelector<HTMLElement>('.copy-btn');
        if (b) b.style.opacity = '0';
      }}
    >
      <p style={{ fontSize: 11, fontWeight: 800, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          className={mono ? 'font-mono-pro' : ''}
          style={{ fontSize: 14, fontWeight: 700, color: strVal ? (accent || '#ffffff') : '#94a3b8', fontStyle: strVal ? 'normal' : 'italic', wordBreak: 'break-all' }}
        >
          {strVal || 'غير متوفر'}
        </span>
        {strVal && (
          <button
            className="copy-btn"
            onClick={() => { navigator.clipboard.writeText(strVal); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
            style={{ flexShrink: 0, opacity: 0, transition: 'opacity 0.2s', background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer', color: copied ? '#34d399' : '#64748b', display: 'flex' }}
          >
            {copied ? <CheckCircle2 style={{ width: 14, height: 14 }} /> : <Copy style={{ width: 14, height: 14 }} />}
          </button>
        )}
      </div>
    </div>
  );
}

/* ─── Copyable Cell Number / Value (White text + Copy button) ─── */
function CopyableCellNumber({ value, label }: { value?: string | number | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  const str = value && value !== '—' ? String(value).trim() : '';

  if (!str) return <span style={{ color: '#ffffff', opacity: 0.5 }}>—</span>;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className="font-mono-pro" style={{ color: '#ffffff', fontWeight: 800, fontSize: 13, letterSpacing: '0.02em' }}>
        {str}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(str);
          setCopied(true);
          toast.success(`تم نسخ ${label || 'الرقم'}: ${str}`);
          setTimeout(() => setCopied(false), 1500);
        }}
        style={{
          background: copied ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)',
          border: `1px solid ${copied ? '#34d399' : 'rgba(255,255,255,0.2)'}`,
          borderRadius: 6,
          padding: '2px 5px',
          cursor: 'pointer',
          color: copied ? '#34d399' : '#ffffff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.15s ease',
        }}
        title={`نسخ ${label || 'الرقم'}`}
      >
        {copied ? (
          <Check style={{ width: 11, height: 11, color: '#34d399' }} />
        ) : (
          <Copy style={{ width: 11, height: 11, color: '#ffffff' }} />
        )}
      </button>
    </div>
  );
}

export default function LookupPage() {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchTargetPeriod, setSearchTargetPeriod] = useState<string>('auto'); // 'auto' or 'YYYY-M'
  const [selectedCandidate, setSelectedCandidate] = useState<SearchCandidate | null>(null);
  const [details, setDetails] = useState<EmployeeDetailsResult | null>(null);
  const [activeProfileTab, setActiveProfileTab] = useState<'unified' | 'timeline'>('unified');
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [availablePeriods, setAvailablePeriods] = useState<MonthAvailability[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [, startTransition] = useTransition();
  const [exportingHistory, setExportingHistory] = useState(false);
  const [searchPurpose, setSearchPurpose] = useState<'general' | 's1' | 's6' | 'details' | 'discrepancy' | 'supplied' | 'archives'>('general');
  const [viewMode, setViewMode] = useState<'lookup' | 'operations_log'>('lookup');
  const [todayOpsCount, setTodayOpsCount] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const refreshTodayOpsCount = useCallback(() => {
    fetch('/api/lookup/search-history?limit=1&date=today')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.stats) setTodayOpsCount(d.stats.today);
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    refreshTodayOpsCount();
  }, [refreshTodayOpsCount]);

  const handleSelectEmployeeFromLog = (emp: { national_id?: string; employee_code?: string; employee_name?: string }) => {
    setViewMode('lookup');
    const natId = emp.national_id?.trim() || '';
    if (natId && natId.length === 14) {
      setQuery(natId);
      handleSearchImmediate(natId, 'auto');
    } else {
      toast.warning('الموظف المحدد لا يتوفر له رقم قومي مكون من 14 رقماً للاستعلام المباشر');
    }
  };

  useEffect(() => {
    fetch('/api/lookup/periods')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.periods.length > 0) {
          setAvailablePeriods(d.periods);
          setSelectedYear(d.periods[0].year);
          setSelectedMonth(d.periods[0].month);
        }
      }).catch(console.error);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const buildSearchUrl = (val: string, periodVal: string = searchTargetPeriod) => {
    let url = `/api/lookup/search?q=${encodeURIComponent(val.trim())}&purpose=${encodeURIComponent(searchPurpose)}`;
    if (periodVal !== 'auto') {
      const [y, m] = periodVal.split('-');
      if (y && m) url += `&year=${y}&month=${m}`;
    }
    return url;
  };

  const handleQueryChange = (val: string, periodVal: string = searchTargetPeriod) => {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);

    let currentPeriod = periodVal;
    const digits = val.replace(/\D/g, '');
    const tokens = val.split(/[\r\n,]+/).map(t => t.replace(/\D/g, '')).filter(t => t.length === 14);

    // If input is empty, reset state
    if (val.trim().length === 0) {
      if (searchTargetPeriod !== 'auto') {
        setSearchTargetPeriod('auto');
        currentPeriod = 'auto';
      }
      setCandidates([]);
      setSearching(false);
      setDropdownOpen(false);
      return;
    }

    // Do NOT trigger search while typing incomplete national ID (< 14 digits)
    // This prevents premature queries that return multiple rows and pollute the search log!
    if (digits.length !== 14 && tokens.length === 0) {
      setCandidates([]);
      setSearching(false);
      setDropdownOpen(false);
      return;
    }

    // When exactly 14 digits are typed (or valid batch tokens), auto-search smoothly
    setSearching(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(buildSearchUrl(val, currentPeriod));
        const data = await res.json();
        if (data.success) {
          const resList = data.results || [];
          setCandidates(resList);
          setDropdownOpen(resList.length > 0);
        }
      } catch { /* noop */ } finally { setSearching(false); }
    }, 200);
  };

  const handleSearchImmediate = async (
    searchTerm?: string,
    periodVal: string = searchTargetPeriod,
    noAutoOpen: boolean = false
  ) => {
    const val = (searchTerm !== undefined ? searchTerm : query).trim();
    if (timerRef.current) clearTimeout(timerRef.current);

    const digits = val.replace(/\D/g, '');
    const tokens = val.split(/[\r\n,]+/).map(t => t.replace(/\D/g, '')).filter(t => t.length === 14);

    if (digits.length !== 14 && tokens.length === 0) {
      if (digits.length > 0 && digits.length < 14) {
        toast.warning(`الرقم القومي غير مكتمل (${digits.length}/14 رقماً). يرجى كتابة الـ 14 رقماً كاملة.`);
      } else if (digits.length > 14) {
        toast.warning(`الرقم القومي يتجاوز 14 رقماً (${digits.length} رقماً). يرجى التأكد من كتابة الرقم القومي الصحيح.`);
      } else {
        toast.info('البحث مخصص بالرقم القومي فقط (14 رقماً). يرجى إدخال الرقم القومي ثم البحث.');
      }
      return;
    }

    setSearching(true);
    setDropdownOpen(false);
    try {
      const res = await fetch(buildSearchUrl(val, periodVal));
      const data = await res.json();
      if (data.success) {
        const results: SearchCandidate[] = data.results || [];
        setCandidates(results);
        refreshTodayOpsCount();
        if (results.length === 0) {
          toast.info('لم يتم العثور على أي موظف بهذا الرقم القومي');
        } else if (!noAutoOpen && results.length === 1) {
          // Exactly 1 match found - open profile immediately
          loadEmployeeDetails(results[0]);
          setDropdownOpen(false);
        } else if (!noAutoOpen) {
          // Check for exact match on national_id
          const exactMatch = results.find(
            (c) => c.national_id === digits
          );
          if (exactMatch) {
            loadEmployeeDetails(exactMatch);
            setDropdownOpen(false);
          } else {
            toast.success(`تم العثور على ${results.length} نتيجة مطابقة`);
          }
        } else {
          toast.success(`تم تحديث بيانات الجدول: ${results.length} نتيجة`);
        }
      }
    } catch {
      toast.error('خطأ أثناء البحث');
    } finally {
      setSearching(false);
    }
  };

  const handleTargetPeriodChange = (newPeriod: string) => {
    setSearchTargetPeriod(newPeriod);
    let targetY: number | undefined;
    let targetM: number | undefined;
    if (newPeriod !== 'auto') {
      const [y, m] = newPeriod.split('-');
      if (y && m) {
        targetY = parseInt(y, 10);
        targetM = parseInt(m, 10);
        setSelectedYear(targetY);
        setSelectedMonth(targetM);
        toast.info(`تم ضبط شهر الفحص على: ${m} / ${y}`);
      }
    } else {
      toast.info('تم ضبط شهر الفحص على: أول شهر ظهور تلقائي');
    }

    const q = query.trim() || (candidates.length > 0 ? (candidates[0].national_id || '') : '');
    if (q.replace(/\D/g, '').length === 14) {
      handleSearchImmediate(q, newPeriod, true);
    } else if (selectedCandidate && details && targetY && targetM) {
      loadEmployeeDetails(selectedCandidate, targetY, targetM);
    }
  };

  const loadEmployeeDetails = async (c: SearchCandidate, year?: number, month?: number) => {
    setLoadingDetails(true);
    setSelectedCandidate(c);
    // Keep candidates so the table of search results stays visible and exportable
    setDropdownOpen(false);

    let y = year;
    let m = month;
    if (y === undefined || m === undefined) {
      if (searchTargetPeriod !== 'auto') {
        const [targetY, targetM] = searchTargetPeriod.split('-');
        y = parseInt(targetY, 10);
        m = parseInt(targetM, 10);
      } else {
        y = c.first_both_year ?? selectedYear;
        m = c.first_both_m ?? selectedMonth;
      }
    }

    setSelectedYear(y);
    setSelectedMonth(m);
    const p = new URLSearchParams();
    if (c.national_id) p.set('national_id', c.national_id);
    if (c.employee_code) p.set('employee_code', c.employee_code);
    if (c.employee_name) p.set('employee_name', c.employee_name);
    if (c.company_account && c.company_account !== '—') p.set('company_account', c.company_account);
    p.set('selected_year', String(y));
    p.set('selected_month', String(m));
    try {
      const res = await fetch(`/api/lookup/details?${p.toString()}`);
      const data = await res.json();
      if (data.success) {
        setDetails(data.details);
        toast.success(`تم استدعاء: ${c.employee_name || 'الموظف'}`);
        if (data.details.conflicts?.length) toast.warning('تعارض في المعرفات بين المصادر!', { duration: 6000 });
      }
    } catch { toast.error('خطأ أثناء استدعاء البيانات'); }
    finally { setLoadingDetails(false); }
  };

  const handlePeriodChange = (y: number, m: number) => {
    setSelectedYear(y); setSelectedMonth(m);
    if (selectedCandidate) startTransition(() => loadEmployeeDetails(selectedCandidate, y, m));
  };

  const handleClearSearch = () => {
    setQuery('');
    setCandidates([]);
    setDropdownOpen(false);
    setSearchTargetPeriod('auto');
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const handleResetToNewSearch = () => {
    setQuery('');
    setCandidates([]);
    setSelectedCandidate(null);
    setDetails(null);
    setDropdownOpen(false);
    setSearchTargetPeriod('auto');
    if (timerRef.current) clearTimeout(timerRef.current);
    toast.info('تم تفريغ الشاشة والعودة للوضع الافتراضي (أول ظهور تلقائي)');
  };

  const handleExportCurrentSearchResults = () => {
    if (!candidates || candidates.length === 0) {
      toast.warning('لا توجد نتائج بحث لتصديرها');
      return;
    }

    const exportRows = candidates.map((c, idx) => {
      const s1Date = c.s1_info?.calculatedDate || c.s1_info?.recordedDate || '—';
      const s6Date = c.s6_info?.calculatedDate || (c.s6_info?.status === 'active' ? 'مستمر' : '—');

      return {
        'م': idx + 1,
        'اسم الموظف': c.employee_name || 'بدون اسم',
        'كود الموظف': c.employee_code || '—',
        'الرقم القومي': c.national_id || '—',
        'الرقم التأميني': c.insurance_number || '—',
        'الوظيفة الحالية': c.job_title || '—',
        'الوظيفة في التأمينات': c.insurance_job_title || '—',
        'الشركة (Account)': c.company_account || 'E.G',
        'أول ظهور مشترك': c.first_both_month || 'غير متوفر',
        'أيام الحضور': c.attendance_days || '—',
        'تاريخ بداية الاشتراك (س1)': s1Date,
        'تاريخ نهاية الاشتراك (س6)': s6Date,
        'رقم الهاتف': c.phone_number || '—',
        'جاهزية س1': (c.s1_info?.status === 'calculated' || Boolean(c.s1_info?.recordedDate)) ? `جاهز ✓ (${c.s1_info?.calculatedDate || c.s1_info?.recordedDate || ''})` : 'غير جاهز',
        'جاهزية س6': c.s6_info?.status === 'calculated' || c.s6_info?.status === 'recorded' ? `جاهز س6 (${c.s6_info?.calculatedDate || ''})` : (c.s6_info?.status === 'active' ? 'مستمر' : '—'),
        'حالة التأمين': c.insurance_status || '—',
        'الحالة الوظيفية': c.status || 'Active',
        'موقف الاستقالات (RES)': c.has_resignation ? `مستقيل (${c.resignation_summary || ''})` : 'لا يوجد استقالة',
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'نتائج البحث المستدعاة');

    // Auto column widths
    const maxCols = Object.keys(exportRows[0] || {}).map(k => ({ wch: Math.max(k.length * 2, 16) }));
    worksheet['!cols'] = maxCols;

    const queryClean = query.trim() || 'نتائج_البحث';
    const filename = `استدعاء_موظفين_${queryClean}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, filename);
    toast.success(`تم تصدير ملف Excel بنجاح: ${candidates.length} موظف مستدعى فقط`);
  };

  const handleExportSearchHistory = async () => {
    setExportingHistory(true);
    const purposeLabelMap: Record<string, string> = {
      general: 'بحث عام',
      s1: 'س1 — تسجيل جديد',
      s6: 'س6 — إنهاء اشتراك',
      details: 'تفاصيل موظف كاملة',
      discrepancy: 'شيت المناقضات',
      supplied: 'تم التوريد',
      archives: 'الأرشيف والمستندات',
    };
    const purposeLabel = purposeLabelMap[searchPurpose] || 'سجل العمليات';
    toast.info(`جاري تجهيز وتصدير ملف Excel لـ ${purposeLabel}...`);

    try {
      const response = await fetch(`/api/lookup/export-search-history?unique=true&purpose=${searchPurpose}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'فشل تصدير سجل البحث');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disp = response.headers.get('Content-Disposition') || '';
      let filename = `سجل_البحث_${searchPurpose}_${new Date().toISOString().split('T')[0]}.xlsx`;
      if (disp.includes('filename=')) {
        const match = disp.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = decodeURIComponent(match[1]);
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success(`تم تصدير ملف Excel بنجاح: ${filename}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'حدث خطأ أثناء التصدير';
      toast.error(message);
    } finally {
      setExportingHistory(false);
    }
  };

  // Check if current active candidate or search results have joint data (in both sheets) for a given year & month
  const isPeriodBothAvailable = (year: number, month: number): boolean => {
    const key = `${year}-${month}`;
    if (selectedCandidate?.joint_periods) {
      return selectedCandidate.joint_periods.includes(key);
    }
    if (candidates.length > 0) {
      return candidates.some((c) => c.joint_periods?.includes(key));
    }
    if (details?.allMonthsHistory) {
      return details.allMonthsHistory.some(
        (m) => m.year === year && m.month === month && m.inPayroll && m.inInsurance
      );
    }
    return false;
  };

  const hasAnyJointPeriod = (): boolean => {
    if (selectedCandidate?.joint_periods) {
      return selectedCandidate.joint_periods.length > 0;
    }
    if (candidates.length > 0) {
      return candidates.some(
        (c) =>
          (c.joint_periods && c.joint_periods.length > 0) ||
          (c.first_both_month &&
            !c.first_both_month.includes('لم يظهر') &&
            !c.first_both_month.includes('غير متوفر'))
      );
    }
    if (details?.allMonthsHistory) {
      return details.allMonthsHistory.some((m) => m.inPayroll && m.inInsurance);
    }
    return false;
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', overflowX: 'clip' }}>
      <div className="orb orb-tl" style={{ opacity: 0.12 }} />
      <div className="orb orb-bl" style={{ opacity: 0.08 }} />

      <main style={{ width: '94%', maxWidth: 1800, margin: '0 auto', padding: '2rem 1rem', flex: 1, position: 'relative', zIndex: 10 }}>

        {/* ═══ VIEW MODE SELECTOR: 360° Lookup vs Operations Log (CRUD & Export) ═══ */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
          <div style={{ display: 'inline-flex', flexWrap: 'wrap', padding: 4, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <button
              type="button"
              onClick={() => setViewMode('lookup')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 12, fontSize: 13, fontWeight: 800,
                background: viewMode === 'lookup' ? '#6366f1' : 'transparent',
                color: viewMode === 'lookup' ? '#ffffff' : '#94a3b8',
                border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              <Search style={{ width: 16, height: 16 }} />
              <span>استدعاء وفحص الموظف 360°</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('operations_log')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '10px 20px', borderRadius: 12, fontSize: 13, fontWeight: 800,
                background: viewMode === 'operations_log' ? '#38bdf8' : 'transparent',
                color: viewMode === 'operations_log' ? '#0f172a' : '#94a3b8',
                border: 'none', cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              <History style={{ width: 16, height: 16 }} />
              <span>سجل العمليات والبحث اليومي (CRUD & Export)</span>
              {todayOpsCount > 0 && (
                <span
                  style={{
                    fontSize: 11, fontWeight: 900, padding: '2px 8px', borderRadius: 999,
                    background: viewMode === 'operations_log' ? '#0f172a' : '#38bdf8',
                    color: viewMode === 'operations_log' ? '#38bdf8' : '#0f172a',
                  }}
                >
                  {todayOpsCount} اليوم
                </span>
              )}
            </button>
          </div>

          {viewMode === 'lookup' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => setViewMode('operations_log')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                  background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)',
                  color: '#38bdf8', cursor: 'pointer',
                }}
              >
                <History style={{ width: 14, height: 14 }} />
                <span>عرض وتعديل جدول سجل البحث ({todayOpsCount})</span>
              </button>
            </div>
          )}
        </div>

        {viewMode === 'operations_log' ? (
          <SearchOperationsLogPanel
            onSelectEmployee={handleSelectEmployeeFromLog}
            onRefreshCount={setTodayOpsCount}
          />
        ) : (
          <>
            {/* ═══ SEARCH HERO ═══ */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="glass-card"
              style={{ borderRadius: 24, padding: '2rem 2.5rem', marginBottom: 20, position: 'relative', zIndex: 40 }}
            >
              {/* corner glow contained */}
              <div style={{ position: 'absolute', inset: 0, borderRadius: 24, overflow: 'hidden', pointerEvents: 'none' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: 250, height: 250, borderRadius: '50%', background: 'radial-gradient(circle at top right, rgba(99,102,241,0.1) 0%, transparent 70%)' }} />
              </div>

              <div style={{ position: 'relative', zIndex: 1 }}>
                <span className="badge-brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 9999, marginBottom: 14 }}>
                  <Sparkles style={{ width: 12, height: 12 }} />
                  محرك الاستعلام والتدقيق الفوري
                </span>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
                  <div>
                    <h1 style={{ fontSize: 28, fontWeight: 900, color: '#fff', letterSpacing: '-0.3px', margin: '0 0 8px' }}>
                      استدعاء وفحص ملف الموظف
                    </h1>
                    <p style={{ fontSize: 13, color: '#94a3b8', margin: 0, maxWidth: 640 }}>
                      البحث مخصص بالرقم القومي فقط (14 رقماً) — دقة تامة في تدقيق السجلات ومطابقة المرتبات والتأمينات ومنع تكرار السجلات
                    </p>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Switch to Operations Table */}
                    <button
                      type="button"
                      onClick={() => setViewMode('operations_log')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '10px 14px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 700,
                        background: 'rgba(56,189,248,0.12)',
                        border: '1px solid rgba(56,189,248,0.3)',
                        color: '#38bdf8',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                      title="فتح جدول سجل العمليات والتحكم الكامل CRUD وتحديد Checkmarks"
                    >
                      <History style={{ width: 15, height: 15 }} />
                      <span>جدول سجل العمليات (CRUD)</span>
                    </button>

                    {/* Export Search History Button — exports ALL ops log, NOT current search */}
                    <button
                      type="button"
                      onClick={() => {
                        // Open the operations log panel so user can see + export from there
                        setViewMode('operations_log');
                        toast.info('افتح جدول سجل العمليات لتصدير السجل الكامل أو المحدد منه');
                      }}
                      disabled={exportingHistory}
                      className="btn-success"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 18px',
                        borderRadius: 12,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: exportingHistory ? 'not-allowed' : 'pointer',
                        opacity: exportingHistory ? 0.6 : 1,
                        border: 'none',
                        whiteSpace: 'nowrap',
                        background: 'linear-gradient(135deg, #0369a1, #0284c7)',
                      }}
                      title="فتح جدول سجل العمليات الكامل — ومنه يمكنك التصدير المحدد أو الحذف"
                    >
                      <History style={{ width: 16, height: 16 }} />
                      <span>سجل العمليات الكامل ({todayOpsCount})</span>
                      <span className="badge-slate" style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4 }}>
                        CRUD
                      </span>
                    </button>
                  </div>
                </div>

                {/* Target Month Mode Filter */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>
                    <Calendar style={{ width: 15, height: 15, color: '#818cf8' }} />
                    <span>نطاق شهر الفحص:</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => handleTargetPeriodChange('auto')}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '5px 12px',
                        borderRadius: 10,
                        fontSize: 11,
                        fontWeight: searchTargetPeriod === 'auto' ? 800 : 600,
                        background: searchTargetPeriod === 'auto' ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.03)',
                        border: searchTargetPeriod === 'auto' ? '1.5px solid #818cf8' : '1px solid rgba(255,255,255,0.08)',
                        color: searchTargetPeriod === 'auto' ? '#ffffff' : '#94a3b8',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <Sparkles style={{ width: 12, height: 12, color: searchTargetPeriod === 'auto' ? '#818cf8' : 'inherit' }} />
                      أول شهر ظهور مشترك (تلقائي)
                      {hasAnyJointPeriod() && (
                        <span
                          title="الموظف متوفر في كلا الشيتين (مرتبات + تأمينات)"
                          className="online-dot-container"
                          style={{ marginRight: 2 }}
                        >
                          <span className="online-dot-ping" />
                          <span className="online-dot-core" />
                        </span>
                      )}
                    </button>

                    {availablePeriods.map((p) => {
                      const val = `${p.year}-${p.month}`;
                      const isActive = searchTargetPeriod === val;
                      const isBoth = isPeriodBothAvailable(p.year, p.month);
                      return (
                        <button
                          key={`hero_target_${val}`}
                          type="button"
                          onClick={() => handleTargetPeriodChange(val)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '5px 12px',
                            borderRadius: 10,
                            fontSize: 11,
                            fontWeight: isActive ? 800 : 600,
                            background: isActive
                              ? 'rgba(99,102,241,0.25)'
                              : isBoth
                                ? 'rgba(16, 185, 129, 0.08)'
                                : 'rgba(255,255,255,0.03)',
                            border: isActive
                              ? '1.5px solid #818cf8'
                              : isBoth
                                ? '1px solid rgba(16, 185, 129, 0.4)'
                                : '1px solid rgba(255,255,255,0.08)',
                            color: isActive ? '#ffffff' : isBoth ? '#a7f3d0' : '#94a3b8',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          title={
                            isBoth
                              ? `متوفر في كلا الشيتين (مرتبات + تأمينات) لشهر ${p.month}/${p.year}`
                              : `فحص شهر ${p.month}/${p.year}`
                          }
                        >
                          <span className="font-mono-pro">شهر {p.month}/{p.year}</span>
                          {isBoth && (
                            <span
                              className="online-dot-container"
                              style={{ marginRight: 2 }}
                            >
                              <span className="online-dot-ping" />
                              <span className="online-dot-core" />
                            </span>
                          )}
                          {isActive && <CheckCircle2 style={{ width: 12, height: 12, color: '#34d399' }} />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ─── Search Purpose Selector ─── */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 18, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#94a3b8', flexShrink: 0 }}>
                    <FileText style={{ width: 14, height: 14, color: '#818cf8' }} />
                    <span>غرض البحث:</span>
                  </div>
                  {([
                    { key: 'general', label: 'بحث عام', emoji: '🔍', border: '#818cf8' },
                    { key: 's1', label: 'س1 — تسجيل تأمين جديد', emoji: '📋', border: '#38bdf8' },
                    { key: 's6', label: 'س6 — إنهاء اشتراك', emoji: '🔴', border: '#fda4af' },
                    { key: 'discrepancy', label: 'شيت المناقضات', emoji: '⚠️', border: '#fbbf24' },
                    { key: 'supplied', label: 'تم التوريد', emoji: '📤', border: '#818cf8' },
                    { key: 'archives', label: 'الأرشيف والمستندات', emoji: '📁', border: '#34d399' },
                    { key: 'details', label: 'تفاصيل موظف كاملة', emoji: '👤', border: '#a78bfa' },
                  ] as const).map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setSearchPurpose(p.key)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '6px 14px', borderRadius: 10, fontSize: 12,
                        fontWeight: searchPurpose === p.key ? 800 : 600,
                        background: searchPurpose === p.key ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)',
                        border: searchPurpose === p.key ? `1.5px solid ${p.border}` : '1px solid rgba(255,255,255,0.08)',
                        color: searchPurpose === p.key ? '#ffffff' : '#94a3b8',
                        cursor: 'pointer', transition: 'all 0.15s ease',
                        boxShadow: searchPurpose === p.key ? `0 0 10px ${p.border}44` : 'none',
                      }}
                    >
                      <span style={{ fontSize: 13 }}>{p.emoji}</span>
                      {p.label}
                      {searchPurpose === p.key && <CheckCircle2 style={{ width: 12, height: 12, color: p.border }} />}
                    </button>
                  ))}
                  {searchPurpose === 's1' && (
                    <span style={{ fontSize: 11, color: '#38bdf8', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 8, padding: '3px 10px', marginRight: 'auto' }}>
                      📌 سيظهر مؤشر جاهزية س1 في النتائج والتقرير
                    </span>
                  )}
                  {searchPurpose === 's6' && (
                    <span style={{ fontSize: 11, color: '#fda4af', background: 'rgba(253,164,175,0.1)', border: '1px solid rgba(253,164,175,0.3)', borderRadius: 8, padding: '3px 10px', marginRight: 'auto' }}>
                      📌 سيظهر مؤشر جاهزية س6 في النتائج والتقرير
                    </span>
                  )}
                  {searchPurpose === 'discrepancy' && (
                    <span style={{ fontSize: 11, color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, padding: '3px 10px', marginRight: 'auto' }}>
                      ⚠️ سيتم فحص المناقضات والنواقص وتوثيقها في شيت المناقضات
                    </span>
                  )}
                  {searchPurpose === 'supplied' && (
                    <span style={{ fontSize: 11, color: '#818cf8', background: 'rgba(129,140,248,0.1)', border: '1px solid rgba(129,140,248,0.3)', borderRadius: 8, padding: '3px 10px', marginRight: 'auto' }}>
                      📤 سيتم فحص وتوثيق أرقام وارد التأمين وتاريخ التوريد
                    </span>
                  )}
                  {searchPurpose === 'archives' && (
                    <span style={{ fontSize: 11, color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 8, padding: '3px 10px', marginRight: 'auto' }}>
                      📁 سيتم فحص استيفاء ملف أصول مسوغات التعيين والأرشيف
                    </span>
                  )}
                </div>

                {/* National ID Exclusive Search Banner & Live Digit Counter */}
                <div style={{ maxWidth: 780, display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: '#38bdf8',
                      background: 'rgba(56,189,248,0.12)',
                      border: '1px solid rgba(56,189,248,0.3)',
                      borderRadius: 10,
                      padding: '4px 12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}>
                      <ShieldCheck style={{ width: 14, height: 14, color: '#38bdf8' }} />
                      <span>البحث مخصص بالرقم القومي فقط (14 رقماً)</span>
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      (حصر الاستعلام لمنع تضخم السجلات والأخطاء الناتجة عن تشابه الأكواد)
                    </span>
                  </div>

                  {/* Real-time 14-digit Counter Badge */}
                  {query.trim().length > 0 && (() => {
                    const count = query.replace(/\D/g, '').length;
                    if (count === 14) {
                      return (
                        <span style={{
                          fontSize: 12,
                          fontWeight: 800,
                          color: '#34d399',
                          background: 'rgba(52,211,153,0.15)',
                          border: '1px solid rgba(52,211,153,0.4)',
                          borderRadius: 10,
                          padding: '4px 12px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                        }}>
                          <CheckCircle2 style={{ width: 14, height: 14 }} />
                          <span>14 / 14 رقماً (مكتمل وجاهز للبحث)</span>
                        </span>
                      );
                    }
                    if (count < 14) {
                      return (
                        <span style={{
                          fontSize: 12,
                          fontWeight: 800,
                          color: '#fbbf24',
                          background: 'rgba(251,191,36,0.15)',
                          border: '1px solid rgba(251,191,36,0.4)',
                          borderRadius: 10,
                          padding: '4px 12px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                        }}>
                          <Clock style={{ width: 14, height: 14 }} />
                          <span>تم كتابة {count} من 14 رقماً (متبقي {14 - count})</span>
                        </span>
                      );
                    }
                    return (
                      <span style={{
                        fontSize: 12,
                        fontWeight: 800,
                        color: '#f87171',
                        background: 'rgba(248,113,113,0.15)',
                        border: '1px solid rgba(248,113,113,0.4)',
                        borderRadius: 10,
                        padding: '4px 12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}>
                        <AlertTriangle style={{ width: 14, height: 14 }} />
                        <span>تنبيه: {count} رقماً (تجاوزت 14 رقماً)</span>
                      </span>
                    );
                  })()}
                </div>

                {/* Search Input Container */}
                <div
                  ref={searchContainerRef}
                  className="search-glow"
                  style={{ position: 'relative', maxWidth: 780, borderRadius: 18 }}
                >
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <Search
                      style={{
                        width: 20,
                        height: 20,
                        color: '#818cf8',
                        position: 'absolute',
                        right: 18,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        pointerEvents: 'none',
                        zIndex: 2,
                      }}
                    />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => handleQueryChange(e.target.value)}
                      onFocus={() => { if (query.replace(/\D/g, '').length === 14) setDropdownOpen(true); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSearchImmediate();
                        } else if (e.key === 'Escape') {
                          setDropdownOpen(false);
                        }
                      }}
                      placeholder={
                        searchTargetPeriod === 'auto'
                          ? "اكتب الرقم القومي فقط (14 رقماً) ثم اضغط بحث أو Enter..."
                          : `فحص شهر ${searchTargetPeriod.split('-')[1]}/${searchTargetPeriod.split('-')[0]}: اكتب الرقم القومي فقط (14 رقماً)...`
                      }
                      className="input-dark font-mono-pro"
                      style={{
                        paddingRight: 52,
                        paddingLeft: 125,
                        paddingTop: 18,
                        paddingBottom: 18,
                        borderRadius: 18,
                        fontSize: 15,
                        fontWeight: 600,
                        letterSpacing: '0.02em',
                      }}
                    />

                    {/* Left controls: Loading dots / Clear button / Search Button */}
                    <div style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 6, zIndex: 3 }}>
                      {searching && (
                        <div style={{ display: 'flex', gap: 4, padding: '0 6px' }}>
                          {[0, 0.15, 0.3].map((d) => (
                            <span key={d} style={{ width: 6, height: 6, borderRadius: '50%', background: '#818cf8', animation: `bounce-dot 0.8s ${d}s ease-in-out infinite` }} />
                          ))}
                        </div>
                      )}

                      {query && !searching && (
                        <button
                          type="button"
                          onClick={handleClearSearch}
                          title="مسح نص البحث"
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: 'none',
                            borderRadius: 8,
                            padding: 7,
                            cursor: 'pointer',
                            color: '#94a3b8',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <X style={{ width: 15, height: 15 }} />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleSearchImmediate()}
                        className="btn-primary"
                        style={{
                          padding: '8px 14px',
                          borderRadius: 12,
                          fontSize: 13,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          cursor: 'pointer',
                          border: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span>بحث</span>
                        <span style={{ fontSize: 10, opacity: 0.7, background: 'rgba(255,255,255,0.18)', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace' }}>↵</span>
                      </button>
                    </div>
                  </div>

                  {/* ─── LIVE AUTOCOMPLETE DROPDOWN (Only when matches actually exist) ─── */}
                  <AnimatePresence>
                    {dropdownOpen && query.trim().length >= 2 && candidates.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        transition={{ duration: 0.15 }}
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 8px)',
                          left: 0,
                          right: 0,
                          borderRadius: 18,
                          background: 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(8,13,26,0.99) 100%)',
                          backdropFilter: 'blur(24px)',
                          border: '1px solid rgba(99,102,241,0.35)',
                          boxShadow: '0 24px 60px rgba(0,0,0,0.85), 0 0 30px rgba(99,102,241,0.15)',
                          zIndex: 100,
                          maxHeight: 420,
                          overflowY: 'auto',
                          padding: '10px',
                        }}
                      >
                        {/* Dropdown Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Sparkles style={{ width: 14, height: 14, color: '#818cf8' }} />
                            <span style={{ fontSize: 12, fontWeight: 800, color: '#f1f5f9' }}>
                              نتائج البحث الفوري ({candidates.length} موظف)
                            </span>
                          </div>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>
                            اضغط على أي موظف لاستدعاء ملفه فوراً
                          </span>
                        </div>

                        {/* Candidate items */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
                          {candidates.map((c, idx) => {
                            const hasJoint = c.first_both_month && !c.first_both_month.includes('لم يظهر') && !c.first_both_month.includes('غير متوفر');
                            return (
                              <div
                                key={`drop_${c.id}_${idx}`}
                                onClick={() => loadEmployeeDetails(c)}
                                className="glass-card-hover"
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 12,
                                  padding: '10px 14px',
                                  borderRadius: 12,
                                  background: 'rgba(255,255,255,0.03)',
                                  border: '1px solid rgba(255,255,255,0.06)',
                                  cursor: 'pointer',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <User style={{ width: 18, height: 18, color: '#818cf8' }} />
                                  </div>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                      <span style={{ fontSize: 14, fontWeight: 800, color: '#ffffff' }}>
                                        {c.employee_name || 'بدون اسم'}
                                      </span>
                                      {c.company_account && c.company_account !== '—' && (
                                        <span className="badge-emerald font-mono-pro" style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                                          {c.company_account}
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 4, fontSize: 11, color: '#ffffff' }}>
                                      <span className="font-mono-pro">كود: <CopyableCellNumber value={c.employee_code} label="كود الموظف" /></span>
                                      <span className="font-mono-pro">ق.ق: <CopyableCellNumber value={c.national_id} label="الرقم القومي" /></span>
                                      {c.insurance_number && <span className="font-mono-pro">تأميني: <CopyableCellNumber value={c.insurance_number} label="الرقم التأميني" /></span>}
                                      {c.phone_number && <span className="font-mono-pro">هاتف: <CopyableCellNumber value={c.phone_number} label="رقم الهاتف" /></span>}
                                      {c.target_month_status ? (
                                        <span
                                          className={
                                            c.target_month_status.inBoth
                                              ? 'badge-emerald font-mono-pro'
                                              : c.target_month_status.inPayroll
                                                ? 'badge-brand font-mono-pro'
                                                : c.target_month_status.inInsurance
                                                  ? 'badge-violet font-mono-pro'
                                                  : 'badge-rose font-mono-pro'
                                          }
                                          style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}
                                        >
                                          شهر {c.target_month_status.month}/{c.target_month_status.year}: {c.target_month_status.statusLabel}
                                          {c.target_month_status.attendance_days ? ` (${c.target_month_status.attendance_days} يوم)` : ''}
                                        </span>
                                      ) : hasJoint ? (
                                        <span style={{ color: '#818cf8' }}>
                                          أول ظهور: شهر {c.first_both_month}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                  <span className="btn-ghost" style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    استدعاء الملف <ChevronLeft style={{ width: 14, height: 14 }} />
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>



            {/* ═══ LOADING ═══ */}
            <AnimatePresence>
              {loadingDetails && (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="glass-card"
                  style={{ borderRadius: 24, padding: '5rem 2rem', textAlign: 'center', marginBottom: 20 }}
                >
                  <div style={{ position: 'relative', width: 60, height: 60, margin: '0 auto 20px' }}>
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2.5px solid rgba(99,102,241,0.2)', borderTop: '2.5px solid #6366f1', animation: 'spin-dual 0.9s linear infinite' }} />
                    <div style={{ position: 'absolute', inset: 10, borderRadius: '50%', border: '2px solid rgba(139,92,246,0.2)', borderBottom: '2px solid #8b5cf6', animation: 'spin-dual 0.6s linear infinite reverse' }} />
                    <div style={{ position: 'absolute', inset: 20, borderRadius: '50%', background: 'rgba(99,102,241,0.15)', animation: 'orb-pulse 2s ease-in-out infinite' }} />
                  </div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 }}>جارٍ استدعاء وتدقيق بيانات الموظف...</h3>
                  <p style={{ fontSize: 12, color: '#475569' }}>فحص أرقام وارد التأمين · ملف RES · ملفات المرتبات والتأمينات</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ═══ SEARCH RESULTS TABLE (When matches exist) ═══ */}
            <AnimatePresence>
              {!loadingDetails && candidates.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="glass-card"
                  style={{ borderRadius: 24, overflow: 'hidden', marginBottom: 20, border: '1px solid rgba(99,102,241,0.3)' }}
                >
                  <div style={{ padding: '1.25rem 1.75rem', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'linear-gradient(90deg, rgba(99,102,241,0.15), rgba(15,23,42,0.6))' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Search style={{ width: 20, height: 20, color: '#818cf8' }} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: 17, fontWeight: 800, color: '#ffffff', margin: '0 0 4px' }}>
                          نتائج البحث الموحدة ({candidates.length} موظف)
                        </h3>
                        <p style={{ fontSize: 12, color: '#cbd5e1', margin: 0 }}>
                          أول شهر ظهور مشترك، وأيام الحضور، والشركة، وحالة التأمين، وموقف الاستقالات • اضغط على أي سطر لفتح الملف الكامل
                        </p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={handleExportCurrentSearchResults}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                          fontWeight: 800,
                          padding: '7px 16px',
                          borderRadius: 10,
                          background: 'linear-gradient(135deg, #059669, #10b981)',
                          color: '#ffffff',
                          border: '1px solid rgba(16,185,129,0.5)',
                          boxShadow: '0 4px 14px rgba(16,185,129,0.3)',
                          cursor: 'pointer',
                        }}
                        title="تصدير نتائج البحث الحالية المعروضة فقط إلى ملف Excel"
                      >
                        <Download style={{ width: 14, height: 14 }} />
                        <span>تصدير النتائج ({candidates.length}) إلى Excel</span>
                      </button>
                      <span className="badge-brand font-mono-pro" style={{ fontSize: 13, padding: '6px 16px', borderRadius: 10, fontWeight: 800 }}>
                        {candidates.length} نتيجة مطابقة
                      </span>
                      {details && (
                        <button
                          type="button"
                          onClick={handleClearSearch}
                          className="glass-card-hover"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 12,
                            fontWeight: 700,
                            padding: '6px 14px',
                            borderRadius: 8,
                            background: 'rgba(255,255,255,0.06)',
                            color: '#cbd5e1',
                            border: '1px solid rgba(255,255,255,0.12)',
                            cursor: 'pointer',
                          }}
                        >
                          <X style={{ width: 14, height: 14 }} />
                          إغلاق النتائج والعودة للملف المفتوح
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ─── Desktop Table (Screens >= 768px) ─── */}
                  <div className="table-scroll hide-mobile">
                    <table className="table-dark">
                      <thead>
                        <tr>
                          <th style={{ color: '#ffffff', width: 40, textAlign: 'center' }}>#</th>
                          <th style={{ color: '#ffffff' }}>اسم الموظف</th>
                          <th style={{ color: '#ffffff' }}>كود الموظف</th>
                          <th style={{ color: '#ffffff' }}>الرقم القومي</th>
                          <th style={{ color: '#ffffff' }}>رقم التأمين</th>
                          <th style={{ color: '#ffffff' }}>الوظيفة</th>
                          <th style={{ color: '#ffffff' }}>الشركة (Account)</th>
                          <th style={{ color: '#ffffff' }}>
                            {searchTargetPeriod !== 'auto'
                              ? 'حالة الشهر المستهدف'
                              : 'أول ظهور (مرتبات + تأمينات)'}
                          </th>
                          <th style={{ color: '#ffffff', textAlign: 'center' }}>أيام الحضور</th>
                          <th style={{ color: '#38bdf8' }}>بداية الاشتراك (س1)</th>
                          <th style={{ color: '#fda4af' }}>نهاية الاشتراك (س6)</th>
                          <th style={{ color: '#a3e635' }}>رقم الهاتف</th>
                          {searchPurpose === 's1' && (
                            <th style={{ color: '#38bdf8', whiteSpace: 'nowrap' }}>جاهزية س1 ✓</th>
                          )}
                          {searchPurpose === 's6' && (
                            <th style={{ color: '#fda4af', whiteSpace: 'nowrap' }}>جاهزية س6 ✓</th>
                          )}
                          {searchPurpose === 'discrepancy' && (
                            <th style={{ color: '#fbbf24', whiteSpace: 'nowrap' }}>موقف المناقضة ⚠️</th>
                          )}
                          {searchPurpose === 'supplied' && (
                            <th style={{ color: '#818cf8', whiteSpace: 'nowrap' }}>موقف التوريد 📤</th>
                          )}
                          {searchPurpose === 'archives' && (
                            <th style={{ color: '#34d399', whiteSpace: 'nowrap' }}>الأرشيف والمستندات 📁</th>
                          )}
                          <th style={{ color: '#ffffff' }}>حالة التأمين</th>
                          <th style={{ color: '#ffffff' }}>الحالة</th>
                          <th style={{ color: '#ffffff' }}>الاستقالات (RES)</th>
                          <th style={{ width: 40, textAlign: 'center' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.map((c, idx) => {
                          const hasJoint = c.first_both_month && !c.first_both_month.includes('لم يظهر') && !c.first_both_month.includes('غير متوفر');
                          const isTargetMode = searchTargetPeriod !== 'auto' && c.target_month_status;
                          const targetMonthLabel = searchTargetPeriod !== 'auto'
                            ? `حالة شهر (${searchTargetPeriod.split('-')[1]}/${searchTargetPeriod.split('-')[0]})`
                            : '';
                          const s1Date = c.s1_info?.calculatedDate || c.s1_info?.recordedDate;
                          const s6Date = c.s6_info?.calculatedDate || (c.s6_info?.status === 'active' ? 'مستمر' : null);

                          const isRowSelected = selectedCandidate && (
                            selectedCandidate.id === c.id ||
                            (selectedCandidate.national_id && selectedCandidate.national_id === c.national_id) ||
                            (selectedCandidate.employee_code && selectedCandidate.employee_code === c.employee_code)
                          );

                          return (
                            <tr
                              key={`${c.id}_${idx}`}
                              onClick={() => loadEmployeeDetails(c)}
                              style={{
                                cursor: 'pointer',
                                transition: 'background 0.15s',
                                background: isRowSelected ? 'rgba(99,102,241,0.22)' : undefined,
                                boxShadow: isRowSelected ? 'inset 3px 0 0 #818cf8' : undefined,
                              }}
                              title="اضغط لفتح الملف الكامل لهذا الموظف"
                            >
                              <td className="font-mono-pro" style={{ color: '#ffffff', fontSize: 12, textAlign: 'center' }}>{idx + 1}</td>
                              <td style={{ fontWeight: 800, color: '#ffffff', fontSize: 14 }}>
                                {c.employee_name || 'بدون اسم'}
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                <CopyableCellNumber value={c.employee_code} label="كود الموظف" />
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                <CopyableCellNumber value={c.national_id} label="الرقم القومي" />
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                <CopyableCellNumber value={c.insurance_number} label="الرقم التأميني" />
                              </td>
                              <td style={{ fontSize: 12, color: '#ffffff', fontWeight: 700 }}>
                                <div style={{ color: '#ffffff' }}>{c.job_title || '—'}</div>
                                {c.insurance_job_title && c.insurance_job_title !== c.job_title && (
                                  <div style={{ fontSize: 10, color: '#cbd5e1' }}>تأمين: {c.insurance_job_title}</div>
                                )}
                              </td>
                              <td>
                                {c.company_account && c.company_account !== '—' ? (
                                  <span className="badge-emerald font-mono-pro" style={{ fontSize: 12, padding: '3px 10px', borderRadius: 8, fontWeight: 800, color: '#ffffff' }}>
                                    {c.company_account}
                                  </span>
                                ) : (
                                  <span style={{ color: '#ffffff', opacity: 0.5 }}>—</span>
                                )}
                              </td>
                              <td>
                                {isTargetMode ? (
                                  c.target_month_status!.inBoth ? (
                                    <span className="badge-emerald font-mono-pro" style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6, color: '#ffffff' }}>
                                      <CheckCircle2 style={{ width: 13, height: 13, color: '#34d399' }} />
                                      {targetMonthLabel}
                                    </span>
                                  ) : c.target_month_status!.inPayroll ? (
                                    <span className="badge-brand font-mono-pro" style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6, color: '#ffffff' }}>
                                      {targetMonthLabel} (مرتبات فقط)
                                    </span>
                                  ) : c.target_month_status!.inInsurance ? (
                                    <span className="badge-amber font-mono-pro" style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6, color: '#ffffff' }}>
                                      {targetMonthLabel} (تأمينات فقط)
                                    </span>
                                  ) : (
                                    <span className="badge-rose" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, color: '#ffffff' }}>
                                      {targetMonthLabel} (غير مسجل ✗)
                                    </span>
                                  )
                                ) : hasJoint ? (
                                  <span className="badge-brand font-mono-pro" style={{ fontSize: 12, padding: '4px 12px', borderRadius: 8, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6, color: '#ffffff' }}>
                                    <Sparkles style={{ width: 13, height: 13, color: '#818cf8' }} />
                                    شهر {c.first_both_month}
                                  </span>
                                ) : (
                                  <span className="badge-slate" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, opacity: 0.7, color: '#ffffff' }}>
                                    {c.first_both_month || 'غير متوفر'}
                                  </span>
                                )}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                {isTargetMode ? (
                                  <span className="font-mono-pro" style={{ fontSize: 14, fontWeight: 900, color: '#ffffff' }}>
                                    {c.target_month_status!.attendance_days ? <CopyableCellNumber value={`${c.target_month_status!.attendance_days} يوم`} label="أيام الحضور" /> : '—'}
                                  </span>
                                ) : (
                                  <span className="font-mono-pro" style={{ fontSize: 14, fontWeight: 900, color: '#ffffff' }}>
                                    {c.attendance_days && c.attendance_days !== '—' ? <CopyableCellNumber value={`${c.attendance_days} يوم`} label="أيام الحضور" /> : '—'}
                                  </span>
                                )}
                              </td>
                              {/* S1: بداية الاشتراك */}
                              <td>
                                <CopyableCellNumber value={s1Date} label="تاريخ بداية الاشتراك (س1)" />
                              </td>
                              {/* S6: نهاية الاشتراك */}
                              <td>
                                <CopyableCellNumber value={s6Date} label="تاريخ نهاية الاشتراك (س6)" />
                              </td>
                              {/* Phone Number */}
                              <td style={{ padding: '10px 12px' }}>
                                <CopyableCellNumber value={c.phone_number} label="رقم الهاتف" />
                              </td>
                              {/* Purpose-based Indicator Column */}
                              {searchPurpose === 's1' && (
                                <td>
                                  {(() => {
                                    const st = c.s1_info?.status;
                                    const dt = c.s1_info?.calculatedDate || c.s1_info?.recordedDate;
                                    if (st === 'calculated' || c.s1_info?.recordedDate) return (
                                      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, background: 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.4)', color: '#38bdf8', whiteSpace: 'nowrap' }}>
                                        ✅ جاهز ({dt})
                                      </span>
                                    );
                                    return (
                                      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#fbbf24', whiteSpace: 'nowrap' }}>
                                        ⚠ يراجع
                                      </span>
                                    );
                                  })()}
                                </td>
                              )}
                              {searchPurpose === 's6' && (
                                <td>
                                  {(() => {
                                    const st = c.s6_info?.status;
                                    const dt = c.s6_info?.calculatedDate;
                                    if (st === 'active') return (
                                      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', color: '#34d399', whiteSpace: 'nowrap' }}>
                                        🟢 مستمر
                                      </span>
                                    );
                                    if (st === 'calculated' || st === 'recorded') return (
                                      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, background: 'rgba(253,164,175,0.15)', border: '1px solid rgba(253,164,175,0.4)', color: '#fda4af', whiteSpace: 'nowrap' }}>
                                        ✅ جاهز ({dt})
                                      </span>
                                    );
                                    return (
                                      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.4)', color: '#fbbf24', whiteSpace: 'nowrap' }}>
                                        ⚠ يراجع
                                      </span>
                                    );
                                  })()}
                                </td>
                              )}
                              {searchPurpose === 'discrepancy' && (
                                <td>
                                  <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.4)', color: '#fbbf24', whiteSpace: 'nowrap' }}>
                                    ⚠️ {c.insurance_status === 'مناقضة' ? 'مناقضة مسجلة' : 'فحص مناقضة'}
                                  </span>
                                </td>
                              )}
                              {searchPurpose === 'supplied' && (
                                <td>
                                  <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, background: 'rgba(129,140,248,0.15)', border: '1px solid rgba(129,140,248,0.4)', color: '#818cf8', whiteSpace: 'nowrap' }}>
                                    {c.insurance_status === 'تم التوريد' ? '📤 تم التوريد' : 'جاهز للتوريد'}
                                  </span>
                                </td>
                              )}
                              {searchPurpose === 'archives' && (
                                <td>
                                  <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.4)', color: '#34d399', whiteSpace: 'nowrap' }}>
                                    📁 فحص الأرشيف
                                  </span>
                                </td>
                              )}
                              <td>
                                {(() => {
                                  const ins = c.insurance_status || '';
                                  const isInsured = /مؤمن|active|مشترك/i.test(ins) && !/غير|ملغ|منته/i.test(ins);
                                  const isUninsured = /غير مؤمن|ملغ|منته|not/i.test(ins);
                                  return (
                                    <span style={{
                                      fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700,
                                      color: '#ffffff',
                                      background: isInsured ? 'rgba(139,92,246,0.18)' : isUninsured ? 'rgba(244,63,94,0.15)' : 'rgba(255,255,255,0.06)',
                                      border: `1px solid ${isInsured ? 'rgba(139,92,246,0.4)' : isUninsured ? 'rgba(244,63,94,0.35)' : 'rgba(255,255,255,0.1)'}`,
                                    }}>{ins || '—'}</span>
                                  );
                                })()}
                              </td>
                              <td>
                                {(() => {
                                  const st = c.status || 'مستمر';
                                  const isActive = /مستمر|active|نشط/i.test(st) && !/غير|not/i.test(st);
                                  const isInactive = /غير|not active|منته|ملغ/i.test(st);
                                  return (
                                    <span style={{
                                      fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700,
                                      color: '#ffffff',
                                      background: isInactive ? 'rgba(244,63,94,0.15)' : isActive ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
                                      border: `1px solid ${isInactive ? 'rgba(244,63,94,0.35)' : isActive ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.1)'}`,
                                    }}>{st}</span>
                                  );
                                })()}
                              </td>
                              <td>
                                {c.has_resignation ? (
                                  <span className="badge-rose" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, color: '#ffffff' }}>
                                    {c.resignation_summary}
                                  </span>
                                ) : (
                                  <span className="badge-emerald" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, color: '#ffffff' }}>
                                    لا توجد استقالة (مستمر)
                                  </span>
                                )}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <ChevronLeft style={{ width: 18, height: 18, color: '#818cf8', opacity: 0.8 }} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* ─── Mobile Cards View (Screens < 768px - No Horizontal Scroll!) ─── */}
                  <div className="show-mobile-flex" style={{ flexDirection: 'column', gap: 12, padding: '12px' }}>
                    {candidates.map((c, idx) => {
                      const hasJoint = c.first_both_month && !c.first_both_month.includes('لم يظهر') && !c.first_both_month.includes('غير متوفر');
                      const isTargetMode = searchTargetPeriod !== 'auto' && c.target_month_status;
                      const targetM = searchTargetPeriod !== 'auto' ? searchTargetPeriod.split('-')[1] : '';
                      const targetY = searchTargetPeriod !== 'auto' ? searchTargetPeriod.split('-')[0] : '';
                      return (
                        <div
                          key={`card_${c.id}_${idx}`}
                          onClick={() => loadEmployeeDetails(c)}
                          className="glass-card-hover"
                          style={{
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            borderRadius: 16,
                            padding: '14px 16px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          {/* Card Header: Name + Company */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                              <span className="font-mono-pro" style={{ fontSize: 11, color: '#94a3b8', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 6, fontWeight: 800 }}>
                                #{idx + 1}
                              </span>
                              <span style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', lineHeight: 1.3 }}>
                                {c.employee_name || 'بدون اسم'}
                              </span>
                            </div>
                            {c.company_account && c.company_account !== '—' && (
                              <span className="badge-emerald font-mono-pro" style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 800, whiteSpace: 'nowrap' }}>
                                {c.company_account}
                              </span>
                            )}
                          </div>

                          {/* Identifiers: Code, National ID & Insurance Number */}
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '8px 10px' }}>
                              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>كود الموظف</div>
                              <CopyableCellNumber value={c.employee_code} label="كود الموظف" />
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '8px 10px' }}>
                              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>الرقم القومي</div>
                              <CopyableCellNumber value={c.national_id} label="الرقم القومي" />
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '8px 10px' }}>
                              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>الرقم التأميني</div>
                              <CopyableCellNumber value={c.insurance_number} label="الرقم التأميني" />
                            </div>
                            {/* Phone Number */}
                            {c.phone_number && (
                              <div style={{ background: 'rgba(163,230,53,0.05)', border: '1px solid rgba(163,230,53,0.2)', borderRadius: 10, padding: '8px 10px' }}>
                                <div style={{ fontSize: 10, color: '#a3e635', marginBottom: 4 }}>رقم الهاتف 📞</div>
                                <CopyableCellNumber value={c.phone_number} label="رقم الهاتف" />
                              </div>
                            )}
                          </div>

                          {/* Job Title */}
                          {(c.job_title || c.insurance_job_title) && (
                            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '8px 10px' }}>
                              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>الوظيفة</div>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#ffffff' }}>
                                {c.job_title || '—'}
                              </div>
                              {c.insurance_job_title && c.insurance_job_title !== c.job_title && (
                                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>تأمينياً: {c.insurance_job_title}</div>
                              )}
                            </div>
                          )}

                          {/* Insurance Forms Dates (S1 & S6) Reference */}
                          {(() => {
                            const s1Date = c.s1_info?.calculatedDate || c.subscription_start_date || (c.s1_info?.status === 'insufficient_data' ? 'يحتاج مراجعة' : null);
                            const s6Date = c.s6_info?.calculatedDate || (c.s6_info?.status === 'active' ? 'مستمر (Active)' : c.subscription_end_date) || (c.s6_info?.status === 'insufficient_data' ? 'يحتاج مراجعة' : null);
                            return (
                              <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: 8,
                                background: 'rgba(56, 189, 248, 0.04)',
                                border: '1px solid rgba(56, 189, 248, 0.2)',
                                borderRadius: 12,
                                padding: '10px 12px'
                              }}>
                                <div>
                                  <div style={{ fontSize: 10, color: '#38bdf8', fontWeight: 700, marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span>بداية الاشتراك (س1)</span>
                                    {c.s1_info?.calculatedDate && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(c.s1_info!.calculatedDate!);
                                          toast.success(`تم نسخ تاريخ س1: ${c.s1_info!.calculatedDate!}`);
                                        }}
                                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: '#38bdf8' }}
                                        title="نسخ"
                                      >
                                        <Copy style={{ width: 11, height: 11 }} />
                                      </button>
                                    )}
                                  </div>
                                  <div className="font-mono-pro" style={{ fontSize: 12, fontWeight: 800, color: '#ffffff' }} title={c.s1_info?.formula}>
                                    {s1Date || '—'}
                                  </div>
                                </div>

                                <div>
                                  <div style={{ fontSize: 10, color: '#fda4af', fontWeight: 700, marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span>نهاية الاشتراك (س6)</span>
                                    {c.s6_info?.calculatedDate && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(c.s6_info!.calculatedDate!);
                                          toast.success(`تم نسخ تاريخ س6: ${c.s6_info!.calculatedDate!}`);
                                        }}
                                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: '#fda4af' }}
                                        title="نسخ"
                                      >
                                        <Copy style={{ width: 11, height: 11 }} />
                                      </button>
                                    )}
                                  </div>
                                  <div
                                    className="font-mono-pro"
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 800,
                                      color: c.s6_info?.calculatedDate ? '#fda4af' : c.s6_info?.status === 'active' ? '#34d399' : '#ffffff'
                                    }}
                                    title={c.s6_info?.formula || c.s6_info?.message}
                                  >
                                    {s6Date || '—'}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Appearance Status: Target Month or First Joint */}
                          {isTargetMode ? (
                            <div style={{
                              background: c.target_month_status!.inBoth ? 'rgba(16, 185, 129, 0.08)' : 'rgba(99, 102, 241, 0.08)',
                              border: `1px solid ${c.target_month_status!.inBoth ? 'rgba(16, 185, 129, 0.25)' : 'rgba(99, 102, 241, 0.25)'}`,
                              borderRadius: 12,
                              padding: '10px 12px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}>
                              <div>
                                <div style={{ fontSize: 10, color: '#cbd5e1', marginBottom: 4 }}>مسجل في كلا الشيتين ✓</div>
                                {c.target_month_status!.inBoth ? (
                                  <span className="badge-emerald font-mono-pro" style={{ fontSize: 12, padding: '3px 10px', borderRadius: 6, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6, color: '#ffffff' }}>
                                    <CheckCircle2 style={{ width: 12, height: 12, color: '#34d399' }} />
                                    حالة شهر ({targetM}/{targetY})
                                  </span>
                                ) : c.target_month_status!.inPayroll ? (
                                  <span className="badge-brand font-mono-pro" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, fontWeight: 800, color: '#ffffff' }}>
                                    حالة شهر ({targetM}/{targetY}) (مرتبات فقط)
                                  </span>
                                ) : c.target_month_status!.inInsurance ? (
                                  <span className="badge-amber font-mono-pro" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, fontWeight: 800, color: '#ffffff' }}>
                                    حالة شهر ({targetM}/{targetY}) (تأمينات فقط)
                                  </span>
                                ) : (
                                  <span className="badge-rose" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, color: '#ffffff' }}>
                                    حالة شهر ({targetM}/{targetY}) (غير مسجل ✗)
                                  </span>
                                )}
                              </div>
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ fontSize: 10, color: '#cbd5e1', marginBottom: 4 }}>حضور الشهر</div>
                                <span className="font-mono-pro" style={{ fontSize: 14, fontWeight: 900, color: c.target_month_status!.attendance_days ? '#34d399' : '#94a3b8' }}>
                                  {c.target_month_status!.attendance_days ? `${c.target_month_status!.attendance_days} يوم` : '—'}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div style={{
                              background: hasJoint ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255,255,255,0.02)',
                              border: `1px solid ${hasJoint ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.06)'}`,
                              borderRadius: 12,
                              padding: '10px 12px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}>
                              <div>
                                <div style={{ fontSize: 10, color: '#cbd5e1', marginBottom: 4 }}>أول ظهور مشترك (مرتبات + تأمينات)</div>
                                {hasJoint ? (
                                  <span className="badge-brand font-mono-pro" style={{ fontSize: 12, padding: '3px 10px', borderRadius: 6, fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 6, color: '#ffffff' }}>
                                    <Sparkles style={{ width: 12, height: 12, color: '#818cf8' }} />
                                    شهر {c.first_both_month}
                                  </span>
                                ) : (
                                  <span className="badge-slate" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6 }}>
                                    {c.first_both_month || 'غير متوفر'}
                                  </span>
                                )}
                              </div>
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ fontSize: 10, color: '#cbd5e1', marginBottom: 4 }}>أيام الحضور</div>
                                <span className="font-mono-pro" style={{ fontSize: 14, fontWeight: 900, color: c.attendance_days && c.attendance_days !== '—' ? '#34d399' : '#94a3b8' }}>
                                  {c.attendance_days && c.attendance_days !== '—' ? `${c.attendance_days} يوم` : '—'}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Status Badges */}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                            {(() => {
                              const ins = c.insurance_status || '';
                              const isInsured = /مؤمن|active|مشترك/i.test(ins) && !/غير|ملغ|منته/i.test(ins);
                              const isUninsured = /غير مؤمن|ملغ|منته|not/i.test(ins);
                              return (
                                <span style={{
                                  fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 700,
                                  color: isInsured ? '#c4b5fd' : isUninsured ? '#fda4af' : '#94a3b8',
                                  background: isInsured ? 'rgba(139,92,246,0.18)' : isUninsured ? 'rgba(244,63,94,0.15)' : 'rgba(255,255,255,0.06)',
                                  border: `1px solid ${isInsured ? 'rgba(139,92,246,0.4)' : isUninsured ? 'rgba(244,63,94,0.35)' : 'rgba(255,255,255,0.1)'}`,
                                }}>{ins || 'تأمين: —'}</span>
                              );
                            })()}
                            {(() => {
                              const st = c.status || 'مستمر';
                              const isActive = /مستمر|active|نشط/i.test(st) && !/غير|not/i.test(st);
                              const isInactive = /غير|not active|منته|ملغ/i.test(st);
                              return (
                                <span style={{
                                  fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 700,
                                  color: isInactive ? '#fda4af' : isActive ? '#6ee7b7' : '#e2e8f0',
                                  background: isInactive ? 'rgba(244,63,94,0.15)' : isActive ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.06)',
                                  border: `1px solid ${isInactive ? 'rgba(244,63,94,0.35)' : isActive ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.1)'}`,
                                }}>{st}</span>
                              );
                            })()}
                          </div>

                          {/* ═══ شيت الرزاين ═══ */}
                          <div style={{
                            borderRadius: 12,
                            padding: '10px 14px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            background: c.has_resignation
                              ? 'rgba(244, 63, 94, 0.12)'
                              : 'rgba(16, 185, 129, 0.08)',
                            border: `1.5px solid ${c.has_resignation ? 'rgba(244,63,94,0.45)' : 'rgba(16,185,129,0.3)'}`,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                              <span style={{ fontSize: 16 }}>{c.has_resignation ? '⚠️' : '✅'}</span>
                              <span style={{ fontSize: 11, fontWeight: 800, color: '#e2e8f0', letterSpacing: '0.02em' }}>فحص شيت الرزاين</span>
                            </div>
                            <span style={{
                              fontSize: 11,
                              fontWeight: 800,
                              padding: '3px 10px',
                              borderRadius: 8,
                              color: c.has_resignation ? '#fda4af' : '#6ee7b7',
                              background: c.has_resignation ? 'rgba(244,63,94,0.18)' : 'rgba(16,185,129,0.15)',
                            }}>
                              {c.has_resignation ? (c.resignation_summary || 'مسجل في الاستقالات ⚠') : 'تم الفحص — لا توجد استقالة ✓'}
                            </span>
                          </div>

                          {/* Action footer */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11 }}>
                            <span style={{ color: '#94a3b8' }}>اضغط لعرض الملف الشهري الكامل</span>
                            <span style={{ color: '#818cf8', fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              عرض الملف <ChevronLeft style={{ width: 14, height: 14 }} />
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ═══ DETAILS ═══ */}
            <AnimatePresence>
              {!loadingDetails && details && (
                <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                    {/* ═══ STICKY QUICK-ID BANNER ═══ */}
                    <div className="quick-id-banner" style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 30,
                      borderRadius: 18,
                      overflow: 'hidden',
                      background: 'linear-gradient(135deg, rgba(15,13,40,0.97), rgba(25,21,65,0.97))',
                      border: `2px solid ${details.resignation.found ? 'rgba(244,63,94,0.55)' : 'rgba(99,102,241,0.45)'}`,
                      backdropFilter: 'blur(20px)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
                    }}>
                      {/* Top row: name + RES badge */}
                      <div style={{
                        padding: '12px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        flexWrap: 'wrap',
                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 42, height: 42, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', flexShrink: 0 }}>
                            <User style={{ width: 22, height: 22, color: '#818cf8' }} />
                          </div>
                          <div>
                            <div style={{ fontSize: 17, fontWeight: 900, color: '#ffffff', lineHeight: 1.2, marginBottom: 4 }}>
                              {details.identifiers.employee_name || 'موظف غير مسمى'}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              <span className="badge-brand font-mono-pro" style={{ fontSize: 11, padding: '2px 9px', borderRadius: 7, fontWeight: 800 }}>
                                كود: {details.identifiers.employee_code || '—'}
                              </span>
                              <span className="badge-slate font-mono-pro" style={{ fontSize: 11, padding: '2px 9px', borderRadius: 7, fontWeight: 800 }}>
                                ق.ق: {details.identifiers.national_id || '—'}
                              </span>
                              {details.incomingInsurance.company_account && (
                                <span className="badge-emerald font-mono-pro" style={{ fontSize: 11, padding: '2px 9px', borderRadius: 7, fontWeight: 800 }}>
                                  Account: {details.incomingInsurance.company_account}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        {/* RES. Check pill */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 14px',
                          borderRadius: 12,
                          background: details.resignation.found ? 'rgba(244,63,94,0.18)' : 'rgba(16,185,129,0.13)',
                          border: `1.5px solid ${details.resignation.found ? 'rgba(244,63,94,0.5)' : 'rgba(16,185,129,0.4)'}`,
                          flexShrink: 0,
                        }}>
                          <span style={{ fontSize: 18 }}>{details.resignation.found ? '⚠️' : '✅'}</span>
                          <div>
                            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, marginBottom: 2 }}>شيت الرزاين</div>
                            <div style={{ fontSize: 12, fontWeight: 900, color: details.resignation.found ? '#fda4af' : '#6ee7b7' }}>
                              {details.resignation.found
                                ? `مسجل (${details.resignation.records.length} سجل) ⚠`
                                : 'لا توجد استقالة ✓'}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Bottom row: key fields grid */}
                      <div style={{ padding: '10px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                        {[
                          { icon: '💼', label: 'الوظيفة', value: details.incomingInsurance.record?.job_title },
                          { icon: '🏢', label: 'الحالة الوظيفية', value: details.incomingInsurance.record?.status, colorFn: (v: string) => /غير|not active|منته|ملغ/i.test(v) ? '#fda4af' : /مستمر|active|نشط/i.test(v) ? '#6ee7b7' : '#e2e8f0' },
                          { icon: '🛡️', label: 'الحالة التأمينية', value: details.incomingInsurance.record?.insurance_status, colorFn: (v: string) => /غير مؤمن|ملغ|منته|not/i.test(v) ? '#fda4af' : /مؤمن|active|مشترك/i.test(v) ? '#c4b5fd' : '#e2e8f0' },
                          {
                            icon: '🔢',
                            label: 'الرقم التأميني',
                            value: details.incomingInsurance.record?.insurance_number,
                            mono: true,
                            copy: !!details.incomingInsurance.record?.insurance_number
                          },
                          {
                            icon: '📅',
                            label: 'بداية الاشتراك (س1)',
                            value: details.s1_calculation?.calculatedDate || details.incomingInsurance.record?.subscription_start_date || (details.s1_calculation?.status === 'insufficient_data' ? 'يحتاج مراجعة' : null),
                            mono: true,
                            colorFn: () => '#38bdf8',
                            tooltip: details.s1_calculation?.formula,
                            copy: !!(details.s1_calculation?.calculatedDate || details.incomingInsurance.record?.subscription_start_date)
                          },
                          {
                            icon: '📅',
                            label: 'نهاية الاشتراك (س6)',
                            value: details.s6_calculation?.calculatedDate || (details.s6_calculation?.status === 'active' ? 'مستمر بالخدمة (Active)' : details.incomingInsurance.record?.subscription_end_date) || (details.s6_calculation?.status === 'insufficient_data' ? 'يحتاج مراجعة' : null),
                            mono: true,
                            colorFn: () => details.s6_calculation?.status === 'active' ? '#34d399' : '#fda4af',
                            tooltip: details.s6_calculation?.formula || details.s6_calculation?.message,
                            copy: !!details.s6_calculation?.calculatedDate
                          },
                        ].filter(f => f.value).map((f, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 7, padding: '6px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} title={f.tooltip}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                              <span style={{ fontSize: 13 }}>{f.icon}</span>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, marginBottom: 1 }}>{f.label}</div>
                                <div className={f.mono ? 'font-mono-pro' : ''} style={{ fontSize: 11, fontWeight: 800, color: f.colorFn ? f.colorFn(String(f.value)) : '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {String(f.value || '—')}
                                </div>
                              </div>
                            </div>
                            {f.copy && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(String(f.value));
                                  toast.success(`تم نسخ ${f.label}: ${f.value}`);
                                }}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: '#818cf8', flexShrink: 0 }}
                                title={`نسخ ${f.label}`}
                              >
                                <Copy style={{ width: 11, height: 11 }} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Conflict alert */}
                    {details.conflicts.length > 0 && (
                      <div className="status-warning" style={{ borderRadius: 18, padding: '1.25rem 1.5rem', display: 'flex', gap: 12 }}>
                        <AlertTriangle style={{ width: 20, height: 20, color: '#fbbf24', flexShrink: 0, marginTop: 2 }} />
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', marginBottom: 8 }}>تعارض في المعرفات</p>
                          {details.conflicts.map((c, i) => <p key={i} style={{ fontSize: 12, color: '#fde68a', margin: '0 0 4px' }}>• {c}</p>)}
                        </div>
                      </div>
                    )}

                    {/* ═══ MASTER PROFILE TABS SWITCHER ═══ */}
                    <div style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px',
                      borderRadius: 16,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                    }}>
                      <button
                        type="button"
                        onClick={() => setActiveProfileTab('unified')}
                        style={{
                          flex: '1 1 200px',
                          minWidth: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          padding: '12px 20px',
                          borderRadius: 12,
                          fontSize: 14,
                          fontWeight: 800,
                          cursor: 'pointer',
                          border: 'none',
                          transition: 'all 0.2s ease',
                          background: activeProfileTab === 'unified'
                            ? 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)'
                            : 'transparent',
                          color: activeProfileTab === 'unified' ? '#ffffff' : '#94a3b8',
                          boxShadow: activeProfileTab === 'unified' ? '0 4px 20px rgba(99,102,241,0.45)' : 'none',
                        }}
                      >
                        <Sparkles style={{ width: 18, height: 18, color: activeProfileTab === 'unified' ? '#fde047' : '#818cf8' }} />
                        <span>الملف الموحد الشامل (360° Profile)</span>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: activeProfileTab === 'unified' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)', fontWeight: 800 }}>
                          بيانات الـ 13 ورقة
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveProfileTab('timeline')}
                        style={{
                          flex: '1 1 200px',
                          minWidth: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 8,
                          padding: '12px 20px',
                          borderRadius: 12,
                          fontSize: 14,
                          fontWeight: 800,
                          cursor: 'pointer',
                          border: 'none',
                          transition: 'all 0.2s ease',
                          background: activeProfileTab === 'timeline'
                            ? 'linear-gradient(135deg, #0284c7 0%, #0ea5e9 100%)'
                            : 'transparent',
                          color: activeProfileTab === 'timeline' ? '#ffffff' : '#94a3b8',
                          boxShadow: activeProfileTab === 'timeline' ? '0 4px 20px rgba(14,165,233,0.45)' : 'none',
                        }}
                      >
                        <Clock style={{ width: 18, height: 18, color: activeProfileTab === 'timeline' ? '#ffffff' : '#38bdf8' }} />
                        <span>فحص الشهور والجدول الزمني (Timeline)</span>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 9999, background: activeProfileTab === 'timeline' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)', fontWeight: 800 }}>
                          المرتبات والتأمينات
                        </span>
                      </button>
                    </div>

                    {/* ═══ TAB 1: UNIFIED 360° PROFILE ═══ */}
                    {activeProfileTab === 'unified' && (
                      <UnifiedEmployeeCard
                        details={details}
                        onSwitchToTimeline={() => setActiveProfileTab('timeline')}
                      />
                    )}

                    {/* ═══ قائمة التأشيرات (Checklist Panel) ═══ */}
                    {activeProfileTab === 'unified' && (
                      <EmployeeChecklistPanel details={details} />
                    )}

                    {/* ═══ TAB 2: MONTHLY TIMELINE ═══ */}
                    {activeProfileTab === 'timeline' && (
                      <>
                        {/* Quick Timeline Selector & Month Switcher */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 18px', borderRadius: 18, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(148,163,184,0.1)' }}>
                          {/* Quick Pills for All Imported Months */}
                          {availablePeriods.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <Clock style={{ width: 14, height: 14, color: '#818cf8' }} />
                                  الانتقال المباشر بين الشهور المستوردة:
                                </span>
                                <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#94a3b8' }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#34d399' }} /> في كلا الشيتين
                                  </span>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#818cf8' }} /> مرتبات فقط
                                  </span>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} /> تأمينات فقط
                                  </span>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#64748b' }} /> غير مسجل
                                  </span>
                                </div>
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {availablePeriods.map((p) => {
                                  const isCurrent = p.year === selectedYear && p.month === selectedMonth;
                                  const hist = details.allMonthsHistory.find((h) => h.year === p.year && h.month === p.month);
                                  const hasPayroll = hist?.payrollRecord != null;
                                  const hasInsurance = hist?.insuranceRecord != null;
                                  const both = hasPayroll && hasInsurance;

                                  let dotColor = '#64748b';
                                  if (both) dotColor = '#34d399';
                                  else if (hasPayroll) dotColor = '#818cf8';
                                  else if (hasInsurance) dotColor = '#f59e0b';

                                  return (
                                    <button
                                      key={`quick_pill_${p.year}_${p.month}`}
                                      type="button"
                                      onClick={() => handlePeriodChange(p.year, p.month)}
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        padding: '6px 14px',
                                        borderRadius: 12,
                                        fontSize: 12,
                                        fontWeight: isCurrent ? 800 : 600,
                                        background: isCurrent
                                          ? 'linear-gradient(135deg, rgba(99,102,241,0.35), rgba(79,70,229,0.35))'
                                          : 'rgba(255,255,255,0.04)',
                                        border: isCurrent ? '1.5px solid #818cf8' : '1px solid rgba(255,255,255,0.08)',
                                        color: isCurrent ? '#ffffff' : '#cbd5e1',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease',
                                        boxShadow: isCurrent ? '0 0 12px rgba(99,102,241,0.3)' : 'none',
                                      }}
                                    >
                                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor }} />
                                      <span className="font-mono-pro">{p.month} / {p.year}</span>
                                      {both && <span style={{ fontSize: 10, color: '#34d399', fontWeight: 900 }}>✓</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Manual Dropdowns Switcher */}
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 10, borderTop: availablePeriods.length > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <Calendar style={{ width: 17, height: 17, color: '#818cf8' }} />
                              <span style={{ fontSize: 13, fontWeight: 700, color: '#ffffff' }}>تدقيق شهر مخصص:</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              {[
                                { label: 'الشهر', val: selectedMonth, onChange: (v: number) => handlePeriodChange(selectedYear, v), opts: Array.from({ length: 12 }, (_, i) => ({ v: i + 1, l: `${i + 1} · ${new Date(2026, i).toLocaleString('ar-EG', { month: 'long' })}` })) },
                                { label: 'السنة', val: selectedYear, onChange: (v: number) => handlePeriodChange(v, selectedMonth), opts: [2024, 2025, 2026, 2027].map(y => ({ v: y, l: String(y) })) },
                              ].map((sel) => (
                                <div key={sel.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.1)' }}>
                                  <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>{sel.label}:</label>
                                  <select
                                    value={sel.val}
                                    onChange={(e) => sel.onChange(parseInt(e.target.value, 10))}
                                    style={{ background: 'transparent', border: 'none', color: '#ffffff', fontSize: 12, fontWeight: 700, cursor: 'pointer', outline: 'none' }}
                                  >
                                    {sel.opts.map((o) => (
                                      <option key={o.v} value={o.v} style={{ background: '#111827' }}>{o.l}</option>
                                    ))}
                                  </select>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Selected Month Status */}
                        {details.selectedMonthStatus && (() => {
                          const { cardCls, badgeCls, Icon: SIcon, iconColor } = getStatusCfg(details.selectedMonthStatus.status);
                          const isBoth = details.selectedMonthStatus.inBoth;
                          const inPay = details.selectedMonthStatus.inPayroll;
                          const inIns = details.selectedMonthStatus.inInsurance;
                          return (
                            <div className={cardCls} style={{ borderRadius: 22, padding: '1.5rem' }}>
                              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <SIcon style={{ width: 24, height: 24, color: iconColor }} />
                                  <span style={{ fontWeight: 800, fontSize: 16, color: '#f1f5f9' }}>
                                    شهر {details.selectedMonthStatus.month}/{details.selectedMonthStatus.year}:
                                  </span>
                                  <span className={badgeCls} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 10, fontWeight: 700 }}>
                                    {details.selectedMonthStatus.status}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                  {/* Payroll status */}
                                  <span
                                    className={inPay ? 'badge-emerald font-mono-pro' : details.selectedMonthStatus.payrollImported ? 'badge-rose font-mono-pro' : 'badge-slate font-mono-pro'}
                                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, fontWeight: 700 }}
                                  >
                                    مرتبات: {inPay ? 'مسجل ✓' : details.selectedMonthStatus.payrollImported ? 'غير مسجل ✗' : 'ملف غير مستورد'}
                                  </span>

                                  {/* Insurance status */}
                                  <span
                                    className={inIns ? 'badge-emerald font-mono-pro' : details.selectedMonthStatus.insuranceImported ? 'badge-rose font-mono-pro' : 'badge-slate font-mono-pro'}
                                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, fontWeight: 700 }}
                                  >
                                    تأمينات: {inIns ? 'مسجل ✓' : details.selectedMonthStatus.insuranceImported ? 'غير مسجل ✗' : 'ملف غير مستورد'}
                                  </span>

                                  {/* Joint match */}
                                  {isBoth ? (
                                    <span className="badge-emerald font-mono-pro" style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, fontWeight: 800, background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.4)' }}>
                                      مسجل في كلا الشيتين معاً ✓
                                    </span>
                                  ) : (
                                    <span className="badge-amber font-mono-pro" style={{ fontSize: 11, padding: '4px 10px', borderRadius: 8, fontWeight: 700, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)' }}>
                                      غير مسجل في كلا الشيتين معاً
                                    </span>
                                  )}
                                </div>
                              </div>
                              <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>{details.selectedMonthStatus.details}</p>
                              {(details.selectedMonthStatus.payrollRecord || details.selectedMonthStatus.insuranceRecord) && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                  {details.selectedMonthStatus.payrollRecord && (
                                    <div style={{ padding: '1rem', borderRadius: 14, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                      <p style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', marginBottom: 10 }}>بيانات المرتبات</p>
                                      <div className="font-mono-pro" style={{ fontSize: 12, color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <span>أيام الحضور: <strong style={{ color: '#f1f5f9' }}>{String(details.selectedMonthStatus.payrollRecord.attendance_days || '—')}</strong></span>
                                        <span>الوظيفة: <strong style={{ color: '#f1f5f9' }}>{String(details.selectedMonthStatus.payrollRecord.job_title || '—')}</strong></span>
                                        <span>الإدارة: <strong style={{ color: '#f1f5f9' }}>{String(details.selectedMonthStatus.payrollRecord.department || '—')}</strong></span>
                                      </div>
                                    </div>
                                  )}
                                  {details.selectedMonthStatus.insuranceRecord && (
                                    <div style={{ padding: '1rem', borderRadius: 14, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                      <p style={{ fontSize: 11, fontWeight: 700, color: '#34d399', marginBottom: 10 }}>بيانات التأمينات</p>
                                      <div className="font-mono-pro" style={{ fontSize: 12, color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <span>الرقم التأميني: <strong style={{ color: '#f1f5f9' }}>{String(details.selectedMonthStatus.insuranceRecord.insurance_number || '—')}</strong></span>
                                        <span>الوظيفة: <strong style={{ color: '#f1f5f9' }}>{String(details.selectedMonthStatus.insuranceRecord.job_title || '—')}</strong></span>
                                        <span>المنطقة: <strong style={{ color: '#f1f5f9' }}>{String(details.selectedMonthStatus.insuranceRecord.region || '—')}</strong></span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Employee Profile */}
                        <div className="glass-card" style={{ borderRadius: 24, overflow: 'hidden' }}>
                          {/* Header */}
                          <div style={{ padding: '1.5rem 2rem', background: 'linear-gradient(135deg, rgba(49,46,129,0.7), rgba(30,27,75,0.9))', borderBottom: '1px solid rgba(99,102,241,0.2)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                              <div style={{ width: 56, height: 56, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.4)' }}>
                                <User style={{ width: 28, height: 28, color: '#818cf8' }} />
                              </div>
                              <div>
                                <h3 style={{ fontSize: 20, fontWeight: 900, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.2px' }}>
                                  {details.identifiers.employee_name || 'موظف غير مسمى'}
                                </h3>
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <span className="badge-brand font-mono-pro" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700 }}>
                                    كود: {details.identifiers.employee_code || '—'}
                                  </span>
                                  <span className="badge-slate font-mono-pro" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700 }}>
                                    ق.ق: {details.identifiers.national_id || '—'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            {details.incomingInsurance.company_account && (
                              <div style={{ textAlign: 'right' }}>
                                <p style={{ fontSize: 10, color: '#34d399', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Account</p>
                                <span className="font-mono-pro" style={{ fontSize: 26, fontWeight: 900, color: '#34d399' }}>{details.incomingInsurance.company_account}</span>
                              </div>
                            )}
                          </div>

                          {/* ═══ Resignation RES. Banner ═══ */}
                          <div style={{
                            margin: '0 2rem 1.25rem',
                            padding: '14px 18px',
                            borderRadius: 14,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            background: details.resignation.found
                              ? 'rgba(244, 63, 94, 0.14)'
                              : 'rgba(16, 185, 129, 0.1)',
                            border: `2px solid ${details.resignation.found ? 'rgba(244,63,94,0.55)' : 'rgba(16,185,129,0.4)'}`,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontSize: 22 }}>{details.resignation.found ? '⚠️' : '✅'}</span>
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 900, color: '#e2e8f0', letterSpacing: '0.03em' }}>فحص شيت الرزاين</div>
                                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>تم البحث في resignation_records</div>
                              </div>
                            </div>
                            <span style={{
                              fontSize: 12,
                              fontWeight: 900,
                              padding: '6px 16px',
                              borderRadius: 10,
                              color: details.resignation.found ? '#fda4af' : '#6ee7b7',
                              background: details.resignation.found ? 'rgba(244,63,94,0.2)' : 'rgba(16,185,129,0.2)',
                              border: `1px solid ${details.resignation.found ? 'rgba(244,63,94,0.4)' : 'rgba(16,185,129,0.4)'}`,
                            }}>
                              {details.resignation.found
                                ? `⚠ مسجل في الاستقالات (${details.resignation.records.length} سجل)`
                                : '✓ لا توجد استقالة مسجلة'}
                            </span>
                          </div>

                          {/* Fields */}
                          <div style={{ padding: '1.5rem 2rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                              <ShieldCheck style={{ width: 15, height: 15, color: '#818cf8' }} />
                              <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>بيانات أرقام وارد التأمين — المصدر الرسمي</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                              {[
                                { label: 'الاسم الكامل', value: details.incomingInsurance.record?.employee_name || details.identifiers.employee_name },
                                { label: 'كود الموظف', value: details.incomingInsurance.record?.employee_code || details.identifiers.employee_code, mono: true },
                                { label: 'الرقم القومي', value: details.incomingInsurance.record?.national_id || details.identifiers.national_id, mono: true },
                                { label: 'Account (الشركة)', value: details.incomingInsurance.company_account, accent: '#34d399' },
                                { label: 'الوظيفة', value: details.incomingInsurance.record?.job_title },
                                { label: 'الرقم التأميني', value: details.incomingInsurance.record?.insurance_number, mono: true, accent: '#818cf8' },
                                { label: 'الحالة الوظيفية', value: details.incomingInsurance.record?.status },
                                { label: 'الحالة التأمينية', value: details.incomingInsurance.record?.insurance_status },
                                { label: 'بداية الاشتراك', value: details.incomingInsurance.record?.subscription_start_date, mono: true },
                                { label: 'نهاية الاشتراك', value: details.incomingInsurance.record?.subscription_end_date, mono: true },
                                { label: 'سبب الانتهاء', value: details.incomingInsurance.record?.termination_reason },
                              ].map((item, i) => <DataRow key={i} {...item} />)}
                            </div>
                          </div>
                        </div>

                        {/* First Appearance & Resignation Grid */}
                        <div className="detail-2col">

                          {/* First Appearance */}
                          <div className="glass-card" style={{ borderRadius: 24, padding: '1.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                              <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}>
                                <Clock style={{ width: 18, height: 18, color: '#818cf8' }} />
                              </div>
                              <div>
                                <h4 style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>أول ظهور تاريخي</h4>
                                <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>أول شهر ظهر فيه الموظف في كل مصدر</p>
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {[
                                { label: 'في المرتبات', data: details.firstAppearances.payroll, color: '#818cf8', bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.2)' },
                                { label: 'في التأمينات', data: details.firstAppearances.insurance, color: '#34d399', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)' },
                                { label: 'في المصدرين معاً', data: details.firstAppearances.both, color: '#a78bfa', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.2)' },
                              ].map(({ label, data, color, bg, border }) => (
                                <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 14, background: bg, border: `1px solid ${border}` }}>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>{label}:</span>
                                  <strong className="font-mono-pro" style={{ fontSize: 13, color: data ? color : '#334155', fontWeight: data ? 800 : 400 }}>
                                    {data ? `${data.month} / ${data.year}` : 'لم يظهر بعد'}
                                  </strong>
                                </div>
                              ))}
                            </div>
                            <p style={{ fontSize: 12, color: '#475569', marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(148,163,184,0.08)', lineHeight: 1.7 }}>
                              📌 {details.firstAppearances.notes}
                            </p>
                          </div>

                          {/* Resignation */}
                          <div className="glass-card" style={{ borderRadius: 24, padding: '1.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                              <div style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)' }}>
                                <Briefcase style={{ width: 18, height: 18, color: '#fb7185' }} />
                              </div>
                              <div>
                                <h4 style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>سجل الاستقالات (RES.)</h4>
                                <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>التحقق من وجود قيد استقالة أو إخلاء طرف</p>
                              </div>
                            </div>
                            {details.resignation.found ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {details.resignation.records.map((r, i) => (
                                  <div key={i} style={{ padding: '1rem', borderRadius: 14, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {[
                                      { k: 'تاريخ الاستقالة', v: r.resignation_date },
                                      { k: 'آخر يوم عمل', v: r.last_working_day },
                                      { k: 'نوع الاستقالة', v: r.resignation_type },
                                      { k: 'نوع توريد التأمينات', v: r.insurance_supply_type },
                                      { k: 'تاريخ التوريد', v: r.supply_date },
                                    ].map(({ k, v }) => (
                                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                                        <span style={{ color: '#94a3b8' }}>{k}:</span>
                                        <strong className="font-mono-pro" style={{ color: '#f1f5f9' }}>{String(v || 'غير محدد')}</strong>
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
                                <div style={{ width: 64, height: 64, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(16,185,129,0.12)', border: '2px solid rgba(16,185,129,0.35)', marginBottom: 4 }}>
                                  <span style={{ fontSize: 30 }}>✅</span>
                                </div>
                                <div>
                                  <p style={{ fontSize: 14, fontWeight: 900, color: '#6ee7b7', marginBottom: 6 }}>تم الفحص — لا توجد استقالة مسجلة</p>
                                  <span style={{ fontSize: 11, color: '#475569' }}>{details.resignation.message}</span>
                                </div>
                                <div style={{ padding: '8px 16px', borderRadius: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', fontSize: 11, color: '#34d399', fontWeight: 700 }}>
                                  ✓ تم البحث في resignation_records ولم يُعثر على سجل
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Historical Table */}
                        <div className="glass-card" style={{ borderRadius: 24, overflow: 'hidden' }}>
                          <div style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(148,163,184,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                            <div style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}>
                              <History style={{ width: 17, height: 17, color: '#818cf8' }} />
                            </div>
                            <div>
                              <p style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>السجل التاريخي الشهري</p>
                              <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>{details.allMonthsHistory.length} شهر مستورد</p>
                            </div>
                          </div>
                          {details.allMonthsHistory.length === 0 ? (
                            <div style={{ padding: '3rem', textAlign: 'center', color: '#334155' }}>
                              <Layers style={{ width: 36, height: 36, margin: '0 auto 10px', opacity: 0.3 }} />
                              <p style={{ margin: 0 }}>لم يتم استيراد أي ملفات شهرية بعد.</p>
                            </div>
                          ) : (
                            <>
                              {/* Desktop History Table (>= 768px) */}
                              <div className="table-scroll hide-mobile">
                                <table className="table-dark">
                                  <thead>
                                    <tr>
                                      <th>الفترة</th>
                                      <th>ملف المرتبات</th>
                                      <th>ملف التأمينات</th>
                                      <th>النتيجة</th>
                                      <th>أيام الحضور</th>
                                      <th>الوظيفة</th>
                                      <th>الإدارة</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {details.allMonthsHistory.map((h, i) => {
                                      const isSelected = h.year === selectedYear && h.month === selectedMonth;
                                      const { badgeCls } = getStatusCfg(h.statusSummary);
                                      const hasPayroll = h.payrollRecord != null;
                                      const hasInsurance = h.insuranceRecord != null;
                                      return (
                                        <tr
                                          key={i}
                                          onClick={() => handlePeriodChange(h.year, h.month)}
                                          style={{
                                            cursor: 'pointer',
                                            background: isSelected ? 'rgba(99,102,241,0.12)' : undefined,
                                            transition: 'background 0.15s ease',
                                          }}
                                          title="اضغط لتدقيق ومقارنة بيانات هذا الشهر"
                                        >
                                          <td className="font-mono-pro" style={{ fontWeight: 800, color: isSelected ? '#818cf8' : '#ffffff', whiteSpace: 'nowrap' }}>
                                            {isSelected && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#6366f1', marginLeft: 8, verticalAlign: 'middle', animation: 'orb-pulse 2s ease-in-out infinite' }} />}
                                            {h.month}/{h.year}
                                          </td>
                                          <td>
                                            {hasPayroll ? (
                                              <span className="badge-emerald" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, color: '#ffffff' }}>مسجل ✓</span>
                                            ) : h.payrollImported ? (
                                              <span className="badge-rose" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, opacity: 0.85, color: '#ffffff' }}>غير مسجل ✗</span>
                                            ) : (
                                              <span className="badge-slate" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, opacity: 0.55, color: '#ffffff' }}>غير مستورد</span>
                                            )}
                                          </td>
                                          <td>
                                            {hasInsurance ? (
                                              <span className="badge-emerald" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, color: '#ffffff' }}>مسجل ✓</span>
                                            ) : h.insuranceImported ? (
                                              <span className="badge-rose" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, opacity: 0.85, color: '#ffffff' }}>غير مسجل ✗</span>
                                            ) : (
                                              <span className="badge-slate" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, opacity: 0.55, color: '#ffffff' }}>غير مستورد</span>
                                            )}
                                          </td>
                                          <td>
                                            <span className={badgeCls} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, color: '#ffffff' }}>{h.statusSummary}</span>
                                          </td>
                                          <td className="font-mono-pro" style={{ fontWeight: 700, color: '#ffffff' }}>
                                            {h.payrollRecord?.attendance_days != null ? String(h.payrollRecord.attendance_days) : '—'}
                                          </td>
                                          <td style={{ color: '#ffffff', fontWeight: 600 }}>{String(h.payrollRecord?.job_title || h.insuranceRecord?.job_title || '—')}</td>
                                          <td style={{ color: '#ffffff', fontWeight: 600 }}>{String(h.payrollRecord?.department || h.insuranceRecord?.department || '—')}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>

                              {/* Mobile History Cards (< 768px - No Horizontal Scroll!) */}
                              <div className="show-mobile-flex" style={{ flexDirection: 'column', gap: 10, padding: 12 }}>
                                {details.allMonthsHistory.map((h, i) => {
                                  const isSelected = h.year === selectedYear && h.month === selectedMonth;
                                  const { badgeCls } = getStatusCfg(h.statusSummary);
                                  const hasPayroll = h.payrollRecord != null;
                                  const hasInsurance = h.insuranceRecord != null;
                                  return (
                                    <div
                                      key={`hist_card_${i}`}
                                      onClick={() => handlePeriodChange(h.year, h.month)}
                                      style={{
                                        background: isSelected ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.02)',
                                        border: `1px solid ${isSelected ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.06)'}`,
                                        borderRadius: 14,
                                        padding: 14,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 10,
                                        cursor: 'pointer',
                                      }}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span className="font-mono-pro" style={{ fontSize: 14, fontWeight: 800, color: isSelected ? '#818cf8' : '#ffffff' }}>
                                          فترة {h.month} / {h.year} {isSelected && '(قيد العرض)'}
                                        </span>
                                        <span className={badgeCls} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 700, color: '#ffffff' }}>
                                          {h.statusSummary}
                                        </span>
                                      </div>
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                        <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '6px 8px', fontSize: 11 }}>
                                          <span style={{ color: '#94a3b8' }}>المرتبات: </span>
                                          <strong style={{ color: hasPayroll ? '#34d399' : h.payrollImported ? '#fb7185' : '#64748b' }}>
                                            {hasPayroll ? 'مسجل ✓' : h.payrollImported ? 'غير مسجل ✗' : 'غير مستورد'}
                                          </strong>
                                        </div>
                                        <div style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, padding: '6px 8px', fontSize: 11 }}>
                                          <span style={{ color: '#94a3b8' }}>التأمينات: </span>
                                          <strong style={{ color: hasInsurance ? '#34d399' : h.insuranceImported ? '#fb7185' : '#64748b' }}>
                                            {hasInsurance ? 'مسجل ✓' : h.insuranceImported ? 'غير مسجل ✗' : 'غير مستورد'}
                                          </strong>
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                        <span style={{ color: '#94a3b8' }}>أيام الحضور:</span>
                                        <span className="font-mono-pro" style={{ color: '#34d399', fontWeight: 800 }}>
                                          {h.payrollRecord?.attendance_days != null ? `${h.payrollRecord.attendance_days} يوم` : '—'}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      </>
                    )}

                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ═══ EMPTY STATE ═══ */}
            <AnimatePresence>
              {!loadingDetails && !details && candidates.length === 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="glass-card"
                  style={{ borderRadius: 28, padding: '5rem 2rem', textAlign: 'center' }}
                >
                  <div style={{ position: 'relative', width: 80, height: 80, margin: '0 auto 24px' }}>
                    <div style={{ position: 'absolute', inset: -10, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.2) 0%, transparent 70%)', animation: 'orb-pulse 3s ease-in-out infinite' }} />
                    <div style={{ position: 'relative', width: 80, height: 80, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(139,92,246,0.12))', border: '1px solid rgba(99,102,241,0.3)' }}>
                      <Layers style={{ width: 40, height: 40, color: '#818cf8' }} />
                    </div>
                  </div>
                  <h3 style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9', margin: '0 0 12px' }}>البحث بالرقم القومي للموظف</h3>
                  <p style={{ fontSize: 13, color: '#94a3b8', maxWidth: 460, margin: '0 auto 28px', lineHeight: 1.8 }}>
                    أدخل الرقم القومي للموظف (14 رقماً) في شريط البحث أعلاه لاستدعاء بطاقة البيانات الشاملة وفحص الموقف التأميني والمالي بدقة
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 16 }}>
                    {[
                      { icon: Building2, label: 'فحص أرقام وارد التأمين' },
                      { icon: FileSpreadsheet, label: 'مقارنة ملفات المرتبات' },
                      { icon: History, label: 'سجل تاريخي شهري' },
                    ].map(({ icon: Icon, label }) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#64748b' }}>
                        <Icon style={{ width: 15, height: 15 }} />
                        {label}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}

      </main>
    </div>
  );
}


