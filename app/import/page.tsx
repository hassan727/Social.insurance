'use client';

import { useEffect, useState } from 'react';
import {
  UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle,
  RefreshCw, AlertCircle, Table, Check, Sparkles,
  Database, Calendar, FileText, FileCheck, ShieldAlert, ShieldCheck, X,
  ArrowLeft, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import type { SourceType, ExpectedColumn } from '@/lib/excelParser';

/* ── Source type config ── */
const SOURCE_TYPES = [
  {
    id: 'official_insurance_print' as SourceType,
    title: 'برنت التأمينات الاجتماعية',
    desc: 'برنت سيستم التأمينات المعتمد (المؤسسة العربية للتوريدات)',
    icon: ShieldCheck,
    color: '#06b6d4',
    bg: 'rgba(6,182,212,0.12)',
    border: 'rgba(6,182,212,0.35)',
    activeBg: 'rgba(6,182,212,0.22)',
  },
  {
    id: 'incoming_insurance' as SourceType,
    title: 'أرقام وارد التأمين',
    desc: 'ملف وارد التأمين والشركات (Account)',
    icon: Database,
    color: '#818cf8',
    bg: 'rgba(99,102,241,0.12)',
    border: 'rgba(99,102,241,0.3)',
    activeBg: 'rgba(99,102,241,0.18)',
  },
  {
    id: 'res' as SourceType,
    title: 'ملف RES.',
    desc: 'سجل الاستقالات وآخر يوم عمل',
    icon: FileText,
    color: '#fb7185',
    bg: 'rgba(244,63,94,0.1)',
    border: 'rgba(244,63,94,0.25)',
    activeBg: 'rgba(244,63,94,0.15)',
  },
  {
    id: 'monthly_payroll' as SourceType,
    title: 'مرتبات شهرية',
    desc: 'ملف حضور ومرتبات شهر محدد',
    icon: FileSpreadsheet,
    color: '#a78bfa',
    bg: 'rgba(139,92,246,0.1)',
    border: 'rgba(139,92,246,0.25)',
    activeBg: 'rgba(139,92,246,0.15)',
  },
  {
    id: 'monthly_insurance' as SourceType,
    title: 'تأمينات شهرية',
    desc: 'ملف اشتراكات تأمينية لشهر محدد',
    icon: FileCheck,
    color: '#34d399',
    bg: 'rgba(16,185,129,0.1)',
    border: 'rgba(16,185,129,0.25)',
    activeBg: 'rgba(16,185,129,0.15)',
  },
];

export default function ImportPage() {
  const [sourceType,      setSourceType]      = useState<SourceType>('incoming_insurance');
  const [selectedFile,    setSelectedFile]    = useState<File | null>(null);
  const [isDragging,      setIsDragging]      = useState(false);
  const [periodYear,      setPeriodYear]      = useState<number | null>(null); // no default: operator must pick the file's real period
  const [periodMonth,     setPeriodMonth]     = useState<number | null>(null);
  const [accounts,        setAccounts]        = useState<{ id: number; account_code: string; account_name: string }[]>([]);
  const [accountsError,   setAccountsError]   = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<string>(''); // no default: explicit account required for monthly imports
  const [loadingPreview,  setLoadingPreview]  = useState(false);
  const [sheets,          setSheets]          = useState<string[]>([]);
  const [selectedSheet,   setSelectedSheet]   = useState<string>('');
  const [headers,         setHeaders]         = useState<string[]>([]);
  const [previewRows,     setPreviewRows]     = useState<Record<string, string>[]>([]);
  const [totalRows,       setTotalRows]       = useState<number>(0);
  const [columnMapping,   setColumnMapping]   = useState<Record<string, string>>({});
  const [expectedColumns, setExpectedColumns] = useState<ExpectedColumn[]>([]);
  const [existingImport,  setExistingImport]  = useState<{ id: string; file_name: string; created_at: string; rows_accepted: number } | null>(null);
  const [importing,       setImporting]       = useState(false);
  const [uploadProgress,  setUploadProgress]  = useState(0);
  const [uploadStage,     setUploadStage]     = useState('');
  type ImportCounts = { new: number; updated: number; unchanged: number; skipped_national_id_only: number; repeats_in_same_file: number; review: Record<string, number> };
  const [previewState,    setPreviewState]    = useState<{ key: string; counts: ImportCounts } | null>(null);
  const [previewing,      setPreviewing]      = useState(false);
  const [importResult,    setImportResult]    = useState<{
    success: boolean; message: string;
    totalRowsRead?: number; rowsAccepted?: number;
    rowsRejected?: number; rejectedReasons?: string[];
  } | null>(null);

  const isMonthly = sourceType === 'monthly_payroll' || sourceType === 'monthly_insurance';
  const activeSrc = SOURCE_TYPES.find((s) => s.id === sourceType)!;

  /* ── Load selectable accounts (explicit choice, no default) ── */
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/company-accounts');
        const data = await res.json();
        if (data.success) setAccounts(data.accounts || []);
        else setAccountsError(true);
      } catch { setAccountsError(true); }
    })();
  }, []);

  const monthlyContextMissing = isMonthly && (!selectedAccount || !periodYear || !periodMonth);
  const requireMonthlyContext = (): boolean => {
    if (!isMonthly) return true;
    if (!selectedAccount) { toast.warning('اختر الحساب (الشركة) أولاً — لا يوجد حساب افتراضي'); return false; }
    if (!periodYear || !periodMonth) { toast.warning('حدد سنة وشهر الملف الفعلية — لا يوجد شهر افتراضي'); return false; }
    return true;
  };

  /* ── File handling ── */
  const handleFileProcess = (file: File) => {
    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast.error('صيغة الملف غير مدعومة. يرجى اختيار .xlsx أو .xls');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error('حجم الملف كبير جداً — الحد الأقصى 20 MB');
      return;
    }
    setSelectedFile(file);
    setSheets([]); setSelectedSheet(''); setHeaders([]);
    setPreviewRows([]); setTotalRows(0); setColumnMapping({});
    setExistingImport(null); setImportResult(null);
    toast.info(`الملف: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
  };

  /* ── Preview ── */
  const handlePreview = async (sheetName?: string) => {
    if (!selectedFile) { toast.warning('اختر ملف Excel أولاً'); return; }
    if (!requireMonthlyContext()) return;
    setLoadingPreview(true); setImportResult(null);
    const tid = toast.loading('جارٍ فحص وقراءة الملف...');
    const fd  = new FormData();
    fd.append('file', selectedFile);
    fd.append('source_type', sourceType);
    if (sheetName) fd.append('sheet_name', sheetName);
    if (isMonthly) { fd.append('period_year', String(periodYear)); fd.append('period_month', String(periodMonth)); fd.append('company_account', selectedAccount); }
    try {
      const res  = await fetch('/api/import/preview', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل فحص الملف');
      setSheets(data.sheets || []);
      setSelectedSheet(data.selectedSheet || data.sheets?.[0] || '');
      setHeaders(data.headers || []);
      setPreviewRows(data.previewRows || []);
      setTotalRows(data.totalRows || 0);
      setColumnMapping(data.mapping || {});
      setExpectedColumns(data.expectedColumns || []);
      setExistingImport(data.existingImport || null);
      const matched = Object.keys(data.mapping || {}).length;
      toast.success(`فحص ناجح — ${data.totalRows} صف، ${matched} عمود مرتبط`, { id: tid });
      if (data.existingImport) toast.warning('يوجد استيراد سابق لهذه الفترة!', { duration: 6000 });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'خطأ أثناء المعاينة', { id: tid });
    } finally { setLoadingPreview(false); }
  };

  // The preview is only valid for exactly this file + sheet + mapping + period + account.
  const importKey = [selectedFile?.name, selectedFile?.size, selectedFile?.lastModified, selectedSheet, JSON.stringify(columnMapping), periodYear, periodMonth, selectedAccount, sourceType].join('|');
  const previewCounts = previewState && previewState.key === importKey ? previewState.counts : null;

  /* ── Preview counts (writes nothing) ── */
  const buildImportForm = (preview: boolean) => {
    const fd = new FormData();
    fd.append('file', selectedFile as File);
    fd.append('source_type', sourceType);
    fd.append('sheet_name', selectedSheet);
    fd.append('column_mapping', JSON.stringify(columnMapping));
    if (preview) fd.append('preview', 'true');
    if (isMonthly) { fd.append('period_year', String(periodYear)); fd.append('period_month', String(periodMonth)); fd.append('company_account', selectedAccount); }
    return fd;
  };
  const handlePreviewCounts = async () => {
    if (!selectedFile || !selectedSheet) { toast.error('يرجى معاينة الملف أولاً'); return; }
    if (!requireMonthlyContext()) return;
    setPreviewing(true); setPreviewState(null);
    try {
      const res = await fetch('/api/import/execute', { method: 'POST', body: buildImportForm(true) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشل حساب الأرقام');
      setPreviewState({ key: importKey, counts: data.counts });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'خطأ أثناء حساب الأرقام');
    } finally { setPreviewing(false); }
  };

  /* ── Execute import ── */
  const handleExecuteImport = async () => {
    if (!selectedFile || !selectedSheet) { toast.error('يرجى معاينة الملف أولاً'); return; }
    if (!requireMonthlyContext()) return;
    setImporting(true); setUploadProgress(10);
    setUploadStage('جارٍ تهيئة البيانات والتحقق من المعايير...');
    const interval = setInterval(() => {
      setUploadProgress((p) => {
        if (p < 40)  { setUploadStage('فحص ومطابقة الصفوف والأعمدة...'); return p + 15; }
        if (p < 80)  { setUploadStage('حقن السجلات في قاعدة البيانات (PostgreSQL)...'); return p + 10; }
        if (p < 95)  { setUploadStage('حفظ سجل التدقيق وبناء الفهارس...'); return p + 2; }
        return p;
      });
    }, 400);
    const fd = buildImportForm(false);
    try {
      const res  = await fetch('/api/import/execute', { method: 'POST', body: fd });
      const data = await res.json();
      clearInterval(interval);
      if (!res.ok) {
        setUploadProgress(0); setUploadStage('');
        throw new Error(data.error || 'فشل الاستيراد');
      }
      setUploadProgress(100); setUploadStage('اكتملت العملية بنجاح!');
      setImportResult({ success: true, message: data.message, totalRowsRead: data.totalRowsRead, rowsAccepted: data.rowsAccepted, rowsRejected: data.rowsRejected, rejectedReasons: data.rejectedReasons });
      toast.success(data.message, { duration: 8000, description: `تم قبول ${data.rowsAccepted} سجل وحفظها.` });
    } catch (err: unknown) {
      clearInterval(interval); setUploadProgress(0); setUploadStage('');
      toast.error(err instanceof Error ? err.message : 'خطأ أثناء الاستيراد');
    } finally { setImporting(false); }
  };

  /* ══════════════════════════════════════ RENDER ══════════════════════════════════════ */
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', overflowX: 'clip' }}>
      <div className="orb orb-tl" style={{ opacity: 0.12 }} />
      <div className="orb orb-bl" style={{ opacity: 0.08 }} />

      <main style={{ width: '94%', maxWidth: 1800, margin: '0 auto', padding: '2rem 1rem', flex: 1, position: 'relative', zIndex: 10 }}>

        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          style={{ marginBottom: 28 }}
        >
          <span className="badge-brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 9999, marginBottom: 12 }}>
            <Sparkles style={{ width: 12, height: 12 }} />
            معالج استيراد ملفات Excel الذكي
          </span>
          <h1 style={{ fontSize: 28, fontWeight: 900, color: '#fff', letterSpacing: '-0.3px', margin: '0 0 6px' }}>
            استيراد بيانات الموظفين
          </h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            معاينة وتدقيق الأعمدة قبل الحقن، مع فحص التكرارات وإظهار نسب الرفع لحظياً
          </p>
        </motion.div>

        {/* ── Upload Progress Banner ── */}
        <AnimatePresence>
          {importing && (
            <motion.div
              initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }}
              className="glass-card"
              style={{ borderRadius: 18, padding: '1.25rem 1.5rem', marginBottom: 20, border: '1px solid rgba(99,102,241,0.3)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <RefreshCw style={{ width: 16, height: 16, color: '#818cf8', animation: 'spin-dual 0.9s linear infinite' }} />
                  </div>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>{uploadStage}</p>
                    <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>جارٍ المعالجة الآمنة للسجلات...</p>
                  </div>
                </div>
                <span className="font-mono-pro" style={{ fontSize: 22, fontWeight: 800, color: '#818cf8' }}>{uploadProgress}%</span>
              </div>
              <div className="progress-bar" style={{ height: 6 }}>
                <motion.div
                  className="progress-fill"
                  style={{ height: 6 }}
                  initial={{ width: '0%' }}
                  animate={{ width: `${uploadProgress}%` }}
                  transition={{ ease: 'easeOut', duration: 0.35 }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Import Result Card ── */}
        <AnimatePresence>
          {importResult && (
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              className="status-success"
              style={{ borderRadius: 20, padding: '1.5rem', marginBottom: 20 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CheckCircle2 style={{ width: 26, height: 26, color: '#34d399' }} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 800, color: '#34d399', margin: '0 0 3px' }}>{importResult.message}</h3>
                    <p style={{ fontSize: 12, color: '#6ee7b7', margin: 0 }}>تم تسجيل العملية في سجل التدقيق.</p>
                  </div>
                </div>
                <button
                  onClick={() => setImportResult(null)}
                  style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 10, padding: 8, cursor: 'pointer', color: '#64748b', display: 'flex' }}
                >
                  <X style={{ width: 16, height: 16 }} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
                {[
                  { label: 'إجمالي الصفوف', value: importResult.totalRowsRead, color: '#94a3b8' },
                  { label: 'سجلات مقبولة',  value: importResult.rowsAccepted,  color: '#34d399' },
                  { label: 'سجلات مرفوضة',  value: importResult.rowsRejected,  color: '#fb7185' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ padding: '1rem', borderRadius: 14, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 5px' }}>{label}</p>
                    <span className="font-mono-pro" style={{ fontSize: 24, fontWeight: 800, color }}>{value ?? 0}</span>
                  </div>
                ))}
              </div>

              {importResult.rejectedReasons?.length ? (
                <div style={{ marginTop: 14, padding: '1rem', borderRadius: 14, background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <AlertCircle style={{ width: 15, height: 15, color: '#fb7185' }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#fb7185' }}>أسباب رفض بعض السجلات:</span>
                  </div>
                  <ul style={{ margin: 0, paddingRight: 16 }}>
                    {importResult.rejectedReasons.map((r, i) => (
                      <li key={i} style={{ fontSize: 12, color: '#fca5a5', marginBottom: 3 }}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ════════════════════════════════════════════════════════
            STEP 1 — Source Type + File Upload
        ════════════════════════════════════════════════════════ */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.45 }}
          className="glass-card"
          style={{ borderRadius: 24, padding: '1.75rem 2rem', marginBottom: 20 }}
        >
          {/* Step header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, paddingBottom: 18, borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 30, height: 30, borderRadius: 10, background: 'linear-gradient(135deg, #4338ca, #6366f1)', color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                1
              </span>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>تحديد نوع المصدر وملف Excel</h2>
                <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>اختر نوع البيانات أولاً ثم ارفع الملف</p>
              </div>
            </div>
            <span style={{ fontSize: 11, color: '#334155', fontWeight: 600 }}>الخطوة 1 من 3</span>
          </div>

          {/* Source Type Grid */}
          <div className="source-type-grid">
            {SOURCE_TYPES.map((s) => {
              const Icon       = s.icon;
              const isSelected = sourceType === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSourceType(s.id);
                    setSheets([]); setPreviewRows([]); setExistingImport(null);
                    toast.info(`المصدر: ${s.title}`);
                  }}
                  style={{
                    textAlign: 'right', padding: '1rem 1.25rem', borderRadius: 18, cursor: 'pointer',
                    background: isSelected ? s.activeBg : 'rgba(255,255,255,0.02)',
                    border: `1.5px solid ${isSelected ? s.border : 'rgba(148,163,184,0.1)'}`,
                    transition: 'all 0.2s ease',
                    transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                    boxShadow: isSelected ? `0 4px 20px ${s.color}20` : 'none',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => { if (!isSelected) { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = s.border; } }}
                  onMouseLeave={(e) => { if (!isSelected) { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'rgba(148,163,184,0.1)'; } }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isSelected ? `${s.color}25` : 'rgba(255,255,255,0.04)', border: `1px solid ${isSelected ? s.border : 'transparent'}` }}>
                      <Icon style={{ width: 19, height: 19, color: isSelected ? s.color : '#64748b' }} />
                    </div>
                    {isSelected && (
                      <span style={{ width: 22, height: 22, borderRadius: '50%', background: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Check style={{ width: 12, height: 12, color: '#fff' }} />
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: isSelected ? s.color : '#94a3b8', margin: '0 0 4px' }}>{s.title}</p>
                  <p style={{ fontSize: 11, color: '#475569', margin: 0, lineHeight: 1.5 }}>{s.desc}</p>
                </button>
              );
            })}
          </div>

          {/* Period Selector (monthly only) */}
          <AnimatePresence>
            {isMonthly && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                style={{ overflow: 'hidden', marginBottom: 20 }}
              >
                <div style={{ padding: '1rem 1.25rem', borderRadius: 16, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Calendar style={{ width: 18, height: 18, color: '#818cf8' }} />
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>حساب وفترة الملف الشهري</p>
                      <p style={{ fontSize: 11, color: '#64748b', margin: 0 }}>اختر الحساب والسنة والشهر الذين ينتمي لهم هذا الملف — بلا أي افتراض تلقائي</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: `1px solid ${!selectedAccount ? 'rgba(251,113,133,0.4)' : 'rgba(52,211,153,0.3)'}` }}>
                      <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>الحساب:</label>
                      <select
                        value={selectedAccount}
                        onChange={(e) => setSelectedAccount(e.target.value)}
                        style={{ background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: 13, fontWeight: 700, cursor: 'pointer', outline: 'none', maxWidth: 220 }}
                      >
                        <option value="" style={{ background: '#111827' }}>اختر الحساب…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.account_code} style={{ background: '#111827' }}>{a.account_name}</option>
                        ))}
                      </select>
                      {accountsError && <span style={{ fontSize: 10, color: '#fb7185' }}>تعذر تحميل الحسابات</span>}
                    </div>
                    {[
                      { label: 'الشهر', value: periodMonth, onChange: setPeriodMonth, options: Array.from({ length: 12 }, (_, i) => ({ v: i + 1, l: `${i + 1} · ${new Date(2026, i).toLocaleString('ar-EG', { month: 'long' })}` })) },
                      { label: 'السنة',  value: periodYear,  onChange: setPeriodYear,  options: [2024, 2025, 2026, 2027].map((y) => ({ v: y, l: String(y) })) },
                    ].map((sel) => (
                      <div key={sel.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: `1px solid ${sel.value === null ? 'rgba(251,113,133,0.4)' : 'rgba(148,163,184,0.1)'}` }}>
                        <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>{sel.label}:</label>
                        <select
                          value={sel.value ?? ''}
                          onChange={(e) => { const v = parseInt(e.target.value, 10); if (!Number.isNaN(v)) sel.onChange(v); }}
                          style={{ background: 'transparent', border: 'none', color: '#f1f5f9', fontSize: 13, fontWeight: 700, cursor: 'pointer', outline: 'none' }}
                        >
                          <option value="" style={{ background: '#111827' }}>اختر…</option>
                          {sel.options.map((o) => (
                            <option key={o.v} value={o.v} style={{ background: '#111827' }}>{o.l}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                    {monthlyContextMissing && (
                      <span style={{ fontSize: 11, color: '#fda4af', alignSelf: 'center' }}>الحساب والشهر والسنة مطلوبون قبل الاستيراد</span>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault(); setIsDragging(false);
              if (e.dataTransfer.files?.[0]) handleFileProcess(e.dataTransfer.files[0]);
            }}
            style={{
              border: `2px dashed ${isDragging ? activeSrc.color : selectedFile ? '#34d399' : 'rgba(148,163,184,0.2)'}`,
              borderRadius: 20, padding: '2.5rem', textAlign: 'center', cursor: 'pointer',
              background: isDragging ? `${activeSrc.color}08` : selectedFile ? 'rgba(16,185,129,0.05)' : 'rgba(255,255,255,0.02)',
              transition: 'all 0.25s ease',
              transform: isDragging ? 'scale(1.01)' : 'scale(1)',
            }}
          >
            <input type="file" id="excel-file" accept=".xlsx,.xls,.csv" onChange={(e) => { if (e.target.files?.[0]) handleFileProcess(e.target.files[0]); }} style={{ display: 'none' }} />
            <label htmlFor="excel-file" style={{ cursor: 'pointer', display: 'block' }}>

              {/* Icon */}
              <div style={{
                width: 64, height: 64, borderRadius: 20, margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: selectedFile ? 'rgba(16,185,129,0.15)' : isDragging ? `${activeSrc.color}15` : 'rgba(255,255,255,0.04)',
                border: `1px solid ${selectedFile ? 'rgba(16,185,129,0.3)' : isDragging ? activeSrc.border : 'rgba(148,163,184,0.1)'}`,
                transition: 'all 0.25s',
              }}>
                {selectedFile
                  ? <FileCheck style={{ width: 32, height: 32, color: '#34d399' }} />
                  : <UploadCloud style={{ width: 32, height: 32, color: isDragging ? activeSrc.color : '#475569' }} />
                }
              </div>

              {selectedFile ? (
                <div>
                  <p style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9', margin: '0 0 8px' }}>{selectedFile.name}</p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <span className="badge-emerald" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700 }}>جاهز للفحص</span>
                    <span className="font-mono-pro" style={{ fontSize: 12, color: '#64748b' }}>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                  <p style={{ fontSize: 12, color: '#818cf8', marginTop: 10, fontWeight: 600 }}>اضغط هنا لاختيار ملف مختلف</p>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 15, fontWeight: 700, color: '#94a3b8', margin: '0 0 8px' }}>
                    {isDragging ? 'أفلت الملف هنا...' : 'اسحب وأفلت ملف Excel أو اضغط للتصفح'}
                  </p>
                  <p style={{ fontSize: 12, color: '#475569', margin: 0, maxWidth: 380, marginInline: 'auto', lineHeight: 1.6 }}>
                    يدعم .xlsx و .xls — الحد الأقصى 20 MB
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 14 }}>
                    {['.xlsx', '.xls', '.csv'].map((ext) => (
                      <span key={ext} className="badge-slate font-mono-pro" style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8 }}>{ext}</span>
                    ))}
                  </div>
                </div>
              )}
            </label>
          </div>

          {/* Preview Button */}
          {selectedFile && (
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-start' }}>
              <button
                type="button"
                onClick={() => handlePreview()}
                disabled={loadingPreview}
                className="btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 24px', borderRadius: 14, fontSize: 13, fontWeight: 700, cursor: loadingPreview ? 'not-allowed' : 'pointer' }}
              >
                {loadingPreview
                  ? <><span style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.25)', borderTop: '2px solid #fff', display: 'inline-block', animation: 'spin-dual 0.7s linear infinite' }} />جارٍ قراءة الملف...</>
                  : <><FileSpreadsheet style={{ width: 17, height: 17 }} />معاينة وفحص الملف<ChevronRight style={{ width: 15, height: 15 }} /></>
                }
              </button>
            </div>
          )}
        </motion.div>

        {/* ════════════════════════════════════════════════════════
            STEP 2 — Sheet + Column Mapping + Preview Table
        ════════════════════════════════════════════════════════ */}
        <AnimatePresence>
          {sheets.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
            >

              {/* Preview of counts before any write */}
              <div className="glass-card" style={{ borderRadius: 18, padding: '1.25rem 1.5rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <p style={{ fontSize: 13, color: '#cbd5e1', margin: 0, lineHeight: 1.7 }}>
                    الرفع تحديث فقط: لا تكرار ولا حذف. اضغط لعرض الأرقام قبل أي حفظ.
                    {existingImport ? ` (يوجد استيراد سابق: ${existingImport.file_name})` : ''}
                  </p>
                  <button type="button" onClick={handlePreviewCounts} disabled={previewing || importing}
                    style={{ padding: '10px 20px', borderRadius: 12, fontWeight: 800, fontSize: 13, cursor: 'pointer', background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', color: '#c7d2fe' }}>
                    {previewing ? 'جارٍ الحساب...' : 'اعرض الأرقام قبل الحفظ'}
                  </button>
                </div>
                {previewCounts && (
                  <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                    {[
                      { label: 'سجلات جديدة', value: previewCounts.new, color: '#34d399' },
                      { label: 'سجلات ستتحدث', value: previewCounts.updated, color: '#fbbf24' },
                      { label: 'بدون تغيير', value: previewCounts.unchanged, color: '#94a3b8' },
                      { label: 'صفوف فيها الرقم القومي فقط (تُتجاهل)', value: previewCounts.skipped_national_id_only, color: '#94a3b8' },
                      { label: 'مكرر داخل نفس الملف', value: previewCounts.repeats_in_same_file, color: '#94a3b8' },
                      { label: 'غير موجود في الماستر (مراجعة)', value: previewCounts.review.import_unmatched_person || 0, color: '#f87171' },
                      { label: 'اسم يختلف عن الماستر (مراجعة)', value: previewCounts.review.import_name_differs || 0, color: '#f87171' },
                      { label: 'تعارض كود (مراجعة)', value: previewCounts.review.import_code_conflict || 0, color: '#f87171' },
                      { label: 'بدون رقم قومي (مراجعة)', value: previewCounts.review.import_no_national_id || 0, color: '#f87171' },
                    ].map((c) => (
                      <div key={c.label} style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: '10px 12px' }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: c.color }}>{c.value}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{c.label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Column Mapping + Preview */}
              <div className="glass-card" style={{ borderRadius: 24, padding: '1.75rem 2rem' }}>

                {/* Step header */}
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 22, paddingBottom: 18, borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 10, background: 'linear-gradient(135deg, #4338ca, #6366f1)', color: '#fff', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>2</span>
                    <div>
                      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>مطابقة وتدقيق الأعمدة</h2>
                      <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>تم التعرف التلقائي — يمكنك التعديل يدوياً</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="badge-brand font-mono-pro" style={{ fontSize: 11, padding: '4px 12px', borderRadius: 10, fontWeight: 700 }}>
                      {totalRows.toLocaleString()} صف
                    </span>
                    <span className="badge-emerald font-mono-pro" style={{ fontSize: 11, padding: '4px 12px', borderRadius: 10, fontWeight: 700 }}>
                      {Object.keys(columnMapping).length}/{expectedColumns.length} مرتبط
                    </span>
                  </div>
                </div>

                {/* Sheet Tabs */}
                {sheets.length > 1 && (
                  <div style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(148,163,184,0.08)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>صفحات العمل ({sheets.length}):</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {sheets.map((s) => (
                        <button
                          key={s} type="button"
                          onClick={() => { setSelectedSheet(s); handlePreview(s); }}
                          className={selectedSheet === s ? 'badge-brand' : 'badge-slate'}
                          style={{ fontSize: 12, padding: '4px 14px', borderRadius: 10, fontWeight: 700, cursor: 'pointer', border: 'none', transition: 'all 0.2s' }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Column Mapping Grid */}
                <div style={{ marginBottom: 24 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 14 }}>
                    خريطة ربط الحقول (حقل النظام ↔ عمود Excel):
                  </p>
                  <div className="col-map-grid">
                    {expectedColumns.map((col) => {
                      const matched = columnMapping[col.key] || '';
                      return (
                        <div
                          key={col.key}
                          style={{
                            padding: '12px 14px', borderRadius: 14,
                            background: matched ? 'rgba(16,185,129,0.06)' : col.required ? 'rgba(244,63,94,0.06)' : 'rgba(255,255,255,0.02)',
                            border: `1px solid ${matched ? 'rgba(16,185,129,0.25)' : col.required ? 'rgba(244,63,94,0.25)' : 'rgba(148,163,184,0.1)'}`,
                            transition: 'all 0.2s',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9' }}>
                              {col.label}
                              {col.required && <strong style={{ color: '#fb7185', marginRight: 3 }}>*</strong>}
                            </span>
                            {matched
                              ? <span className="badge-emerald" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}><Check style={{ width: 10, height: 10 }} />متطابق</span>
                              : <span className="badge-slate"   style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6 }}>غير مرتبط</span>
                            }
                          </div>
                          <select
                            value={matched}
                            onChange={(e) => {
                              const val = e.target.value;
                              setColumnMapping((p) => ({ ...p, [col.key]: val }));
                              toast.info(`${col.label} → "${val || 'لا شيء'}"`);
                            }}
                            style={{ width: '100%', background: 'rgba(4,8,20,0.8)', border: '1px solid rgba(148,163,184,0.15)', borderRadius: 10, padding: '7px 10px', fontSize: 12, fontWeight: 600, color: '#f1f5f9', outline: 'none', cursor: 'pointer', transition: 'border-color 0.2s' }}
                            onFocus={(e) => (e.target.style.borderColor = '#6366f1')}
                            onBlur={(e) => (e.target.style.borderColor = 'rgba(148,163,184,0.15)')}
                          >
                            <option value="">— اختر عمود Excel —</option>
                            {headers.map((h) => (
                              <option key={h} value={h} style={{ background: '#111827' }}>{h}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Preview Table */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Table style={{ width: 16, height: 16, color: '#818cf8' }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>معاينة أول 10 صفوف</span>
                    </div>
                    <span style={{ fontSize: 11, color: '#475569' }}>القيم الأصلية كما هي في Excel</span>
                  </div>
                  <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.1)', maxHeight: 280, overflowY: 'auto', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', minWidth: 600 }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'rgba(10,15,30,0.98)', borderBottom: '1px solid rgba(99,102,241,0.15)' }}>
                        <tr>
                          {headers.map((h, i) => (
                            <th key={i} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, rIdx) => (
                          <tr key={rIdx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.15s' }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(99,102,241,0.05)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            {headers.map((h, cIdx) => (
                              <td key={cIdx} className="font-mono-pro" style={{ padding: '10px 14px', fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                                {row[h] || <span style={{ color: '#334155' }}>—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* ════ STEP 3 — Execute Button ════ */}
                <div style={{ paddingTop: 20, borderTop: '1px solid rgba(148,163,184,0.08)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>3</span>
                    <p style={{ fontSize: 12, color: '#64748b', margin: 0, maxWidth: 420 }}>
                      الضغط على الاعتماد سيحفظ البيانات مع قيود منع التكرار وحساب أول ظهور تلقائياً.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleExecuteImport}
                    disabled={importing || !previewCounts}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '13px 28px', borderRadius: 14, fontSize: 14, fontWeight: 800, cursor: (importing || !previewCounts) ? 'not-allowed' : 'pointer',
                      background: 'linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)',
                      border: '1px solid rgba(16,185,129,0.4)',
                      color: '#fff',
                      boxShadow: '0 4px 20px rgba(16,185,129,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
                      transition: 'all 0.25s ease',
                      opacity: (importing || !previewCounts) ? 0.45 : 1,
                    }}
                    onMouseEnter={(e) => { if (!importing) e.currentTarget.style.boxShadow = '0 8px 32px rgba(16,185,129,0.45)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(16,185,129,0.3), inset 0 1px 0 rgba(255,255,255,0.1)'; }}
                  >
                    {importing
                      ? <><span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', display: 'inline-block', animation: 'spin-dual 0.7s linear infinite' }} />جارٍ الاستيراد...</>
                      : <><CheckCircle2 style={{ width: 19, height: 19 }} />اعتماد وحقن البيانات في القاعدة<ArrowLeft style={{ width: 16, height: 16 }} /></>
                    }
                  </button>
                </div>
              </div>

            </motion.div>
          )}
        </AnimatePresence>

      </main>
    </div>
  );
}
