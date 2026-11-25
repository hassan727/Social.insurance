'use client';

import { useEffect, useState } from 'react';
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Database,
  Sparkles, Building2, RefreshCw, FileText, History, Download, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

interface SheetInfo {
  excel_name: string;
  is_registered: boolean;
  display_name: string;
  description: string;
  row_count: number;
  column_definitions: unknown[];
}

interface PreviewData {
  file_name: string;
  company_account: string;
  total_sheets: number;
  registered_sheets_count: number;
  unregistered_sheets_count?: number;
  available_sheets: SheetInfo[];
  preview_sheet: {
    sheet_name: string;
    display_name: string;
    headers: string[];
    preview_rows: Record<string, string>[];
  } | null;
}

interface ImportResult {
  success: boolean;
  message: string;
  summary: {
    total_sheets_imported: number;
    total_new_employees: number;
    total_updated_employees: number;
    total_skipped_rows: number;
    total_errors: number;
    total_cross_account_conflicts?: number;
    sheets_success: number;
    sheets_partial?: number;
    sheets_failed: number;
  };
  detailed_results: Record<string, {
    success: boolean;
    total_rows: number;
    new_employees: number;
    updated_employees: number;
    skipped_rows: number;
    errors: string[];
    warnings?: string[];
    cross_account_conflicts?: Array<{ national_id?: string; employee_name?: string; master_account?: string; row_account?: string }>;
  }>;
}

export default function SmartImportPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // Accounts come from the same source the API validates against
  // (/api/company-accounts). Nothing is pre-selected: the operator must
  // choose explicitly, and the code is validated server-side.
  const [accounts, setAccounts] = useState<{ id: number; account_code: string; account_name: string }[]>([]);
  const [companyAccount, setCompanyAccount] = useState<string>('');

  useEffect(() => {
    fetch('/api/company-accounts')
      .then((r) => r.json())
      .then((d) => { if (d?.accounts) setAccounts(d.accounts); })
      .catch(() => {});
  }, []);
  const [isDragging, setIsDragging] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importProgress, setImportProgress] = useState({
    currentSheet: '',
    currentSheetIndex: 0,
    totalSheets: 0,
    currentSheetProgress: 0,
    overallProgress: 0,
    message: '',
  });

  const handleFileSelect = (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast.error('صيغة الملف غير مدعومة. يرجى اختيار .xlsx أو .xls');
      return;
    }
    setSelectedFile(file);
    setPreviewData(null);
    setSelectedSheets([]);
    setImportResult(null);
    toast.success(`تم اختيار: ${file.name}`);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handlePreview = async () => {
    if (!selectedFile) {
      toast.error('يرجى اختيار ملف أولاً');
      return;
    }
    if (!companyAccount) {
      toast.error('يرجى اختيار حساب الشركة صراحةً أولاً');
      return;
    }

    setLoadingPreview(true);
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('company_account', companyAccount);

    try {
      const res = await fetch('/api/smart-import/preview', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'فشلت المعاينة');

      setPreviewData(data);
      // Auto-select all available sheets
      setSelectedSheets(data.available_sheets.map((s: SheetInfo) => s.excel_name));
      toast.success(`تم تحليل ${data.registered_sheets_count} ورقة من ${data.total_sheets}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'حدث خطأ أثناء المعاينة');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFile || selectedSheets.length === 0) {
      toast.error('يرجى اختيار ملف وورقة واحدة على الأقل');
      return;
    }

    setImporting(true);
    setImportResult(null);

    const startTime = Date.now();
    const combinedSummary = {
      total_sheets_imported: 0,
      total_new_employees: 0,
      total_updated_employees: 0,
      total_skipped_rows: 0,
      total_errors: 0,
      total_cross_account_conflicts: 0,
      sheets_success: 0,
      sheets_partial: 0,
      sheets_failed: 0,
    };
    const combinedSheetResults: Record<string, any> = {};

    try {
      for (let sIdx = 0; sIdx < selectedSheets.length; sIdx++) {
        const sheetName = selectedSheets[sIdx];
        const sheetInfo = previewData?.available_sheets.find((s) => s.excel_name === sheetName);
        const displayName = sheetInfo?.display_name || sheetName;
        const currentPercent = Math.round((sIdx / selectedSheets.length) * 100);

        setImportProgress({
          currentSheet: displayName,
          currentSheetIndex: sIdx + 1,
          totalSheets: selectedSheets.length,
          currentSheetProgress: 10,
          overallProgress: currentPercent,
          message: `جاري استيراد: ${displayName} (${sIdx + 1} من ${selectedSheets.length})...`,
        });

        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('company_account', companyAccount);
        formData.append('selected_sheets', JSON.stringify([sheetName]));

        const res = await fetch('/api/smart-import/execute', {
          method: 'POST',
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || `فشل استيراد ورقة "${displayName}"`);
        }

        // Aggregate summary
        combinedSummary.total_sheets_imported += 1;
        if (data.summary) {
          combinedSummary.total_new_employees += data.summary.total_new_employees || 0;
          combinedSummary.total_updated_employees += data.summary.total_updated_employees || 0;
          combinedSummary.total_skipped_rows += data.summary.total_skipped_rows || 0;
          combinedSummary.total_errors += data.summary.total_errors || 0;
          combinedSummary.total_cross_account_conflicts += data.summary.total_cross_account_conflicts || 0;
        }
        // Distinguish fully successful worksheets from processed-with-issues:
        // a sheet with errors/conflicts is NOT a full success.
        const sheetIssues = ((data.summary && data.summary.total_errors) || 0) + ((data.summary && data.summary.total_cross_account_conflicts) || 0);
        if (data.success === false || (data.summary && data.summary.sheets_failed > 0)) {
          combinedSummary.sheets_failed += 1;
        } else if (sheetIssues > 0) {
          combinedSummary.sheets_partial += 1;
        } else {
          combinedSummary.sheets_success += (data.summary && data.summary.sheets_success) || 1;
        }
        // Route returns detailed_results; accept sheet_results for safety.
        const perSheet = data.detailed_results || data.sheet_results;
        if (perSheet) {
          Object.assign(combinedSheetResults, perSheet);
        }

        const nextPercent = Math.round(((sIdx + 1) / selectedSheets.length) * 100);
        setImportProgress({
          currentSheet: displayName,
          currentSheetIndex: sIdx + 1,
          totalSheets: selectedSheets.length,
          currentSheetProgress: 100,
          overallProgress: nextPercent,
          message: `تم استيراد ${displayName} بنجاح (${sIdx + 1} من ${selectedSheets.length})`,
        });
      }

      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const issueCount = (combinedSummary.total_errors || 0) + (combinedSummary.total_cross_account_conflicts || 0);
      const failedSheets = combinedSummary.sheets_failed || 0;
      const hasIssues = issueCount > 0 || failedSheets > 0;
      const finalMessage = failedSheets > 0
        ? `فشل استيراد ${failedSheets} من ${selectedSheets.length} ورقة — راجع الأخطاء بالأسفل`
        : hasIssues
          ? `اكتمل الاستيراد جزئيًا في ${elapsedTime} ثانية: ${issueCount} صف/تعارض يحتاج مراجعة — لم تُعتمد اللقطة كاملة`
          : `تم استيراد ${selectedSheets.length} ورقة بنجاح في ${elapsedTime} ثانية`;
      setImportProgress({
        currentSheet: hasIssues ? 'اكتمل مع مراجعة' : 'اكتمل بنجاح',
        currentSheetIndex: selectedSheets.length,
        totalSheets: selectedSheets.length,
        currentSheetProgress: 100,
        overallProgress: 100,
        message: finalMessage,
      });

      setImportResult({
        success: !hasIssues,
        message: finalMessage,
        summary: combinedSummary,
        detailed_results: combinedSheetResults,
      });
      if (hasIssues) {
        toast.error(finalMessage);
      } else {
        toast.success(finalMessage);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'حدث خطأ أثناء الاستيراد');
      setImportProgress({
        currentSheet: 'فشل',
        currentSheetIndex: 0,
        totalSheets: selectedSheets.length,
        currentSheetProgress: 0,
        overallProgress: 0,
        message: 'توقف الاستيراد بسبب خطأ',
      });
    } finally {
      setImporting(false);
    }
  };

  const toggleSheet = (sheetName: string) => {
    setSelectedSheets((prev) =>
      prev.includes(sheetName)
        ? prev.filter((s) => s !== sheetName)
        : [...prev, sheetName]
    );
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', overflowX: 'clip' }}>
      <div className="orb orb-tl" />
      <div className="orb orb-bl" />

      <main style={{ width: '94%', maxWidth: 1400, margin: '0 auto', padding: '2rem 1rem', position: 'relative', zIndex: 10 }}>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card"
          style={{ borderRadius: 20, padding: '2rem', marginBottom: 24 }}
        >
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderRadius: 9999, background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))', border: '1px solid rgba(99,102,241,0.3)', marginBottom: 16 }}>
            <Sparkles style={{ width: 14, height: 14, color: '#818cf8' }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: '#a5b4fc' }}>استيراد ذكي متعدد الورقات</span>
          </div>

          <h1 style={{ fontSize: 32, fontWeight: 900, color: '#fff', margin: '0 0 12px', letterSpacing: '-0.02em' }}>
            استيراد ملف Excel متعدد الورقات
          </h1>
          <p style={{ fontSize: 15, color: '#94a3b8', margin: 0, maxWidth: 740, lineHeight: 1.6 }}>
            ارفع ملف EGYPT GAS الكامل، اختر الورقات المطلوبة، والنظام سيقوم بـ Matching ذكي وتحديث البيانات تلقائياً
          </p>
        </motion.div>

        {/* Company Account Selection */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card"
          style={{ borderRadius: 16, padding: '1.5rem', marginBottom: 24 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Building2 style={{ width: 20, height: 20, color: '#818cf8' }} />
            <span style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>اختر حساب الشركة:</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {accounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => setCompanyAccount(acc.account_code)}
                className={companyAccount === acc.account_code ? 'btn-primary' : 'btn-ghost'}
                style={{
                  padding: '14px 20px',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  transition: 'all 0.2s ease',
                }}
              >
                <Building2 style={{ width: 16, height: 16 }} />
                {acc.account_name || acc.account_code}
              </button>
            ))}
          </div>
        </motion.div>

        {/* File Upload */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-card"
          style={{ borderRadius: 16, padding: '2rem', marginBottom: 24 }}
        >
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${isDragging ? '#818cf8' : 'rgba(148,163,184,0.2)'}`,
              borderRadius: 16,
              padding: '3rem 2rem',
              textAlign: 'center',
              background: isDragging ? 'rgba(99,102,241,0.08)' : 'rgba(255,255,255,0.02)',
              transition: 'all 0.3s ease',
            }}
          >
            <Upload style={{ width: 56, height: 56, color: '#818cf8', margin: '0 auto 20px', strokeWidth: 1.5 }} />
            <h3 style={{ fontSize: 19, fontWeight: 800, color: '#fff', margin: '0 0 10px', letterSpacing: '-0.01em' }}>
              {selectedFile ? selectedFile.name : 'اسحب ملف Excel هنا أو اضغط للاختيار'}
            </h3>
            <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 24px', lineHeight: 1.5 }}>
              يدعم .xlsx و .xls - حتى 50 ميجابايت
            </p>

            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              style={{ display: 'none' }}
              id="file-input"
            />

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <label htmlFor="file-input" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                <FileSpreadsheet style={{ width: 18, height: 18 }} />
                <span>اختر ملف</span>
              </label>

              {selectedFile && (
                <button
                  onClick={handlePreview}
                  disabled={loadingPreview}
                  className="btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 12, fontSize: 14, fontWeight: 700, opacity: loadingPreview ? 0.6 : 1 }}
                >
                  {loadingPreview ? (
                    <>
                      <RefreshCw style={{ width: 18, height: 18 }} className="spin" />
                      <span>جاري التحليل...</span>
                    </>
                  ) : (
                    <>
                      <Database style={{ width: 18, height: 18 }} />
                      <span>تحليل الملف</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Preview Data */}
        {previewData && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card"
            style={{ borderRadius: 16, padding: '2rem', marginBottom: 24 }}
          >
            {/* Import Progress */}
            {importing && (
              <div style={{ marginBottom: 24, padding: '20px', borderRadius: 14, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <RefreshCw style={{ width: 20, height: 20, color: '#818cf8' }} className="spin" />
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 800, color: '#fff', margin: '0 0 4px' }}>
                        {importProgress.message}
                      </p>
                      <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
                        الورقة {importProgress.currentSheetIndex + 1} من {importProgress.totalSheets}
                        {importProgress.currentSheet && ` • ${importProgress.currentSheet}`}
                      </p>
                    </div>
                  </div>
                  <span style={{ fontSize: 24, fontWeight: 900, color: '#818cf8', fontFamily: 'monospace' }}>
                    {Math.round(importProgress.overallProgress)}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div style={{ width: '100%', height: 8, borderRadius: 9999, background: 'rgba(148,163,184,0.15)', overflow: 'hidden', position: 'relative' }}>
                  <motion.div
                    initial={{ width: '0%' }}
                    animate={{ width: `${importProgress.overallProgress}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    style={{
                      height: '100%',
                      background: 'linear-gradient(90deg, #4338ca 0%, #6366f1 50%, #818cf8 100%)',
                      borderRadius: 9999,
                      position: 'relative',
                      boxShadow: '0 0 20px rgba(99,102,241,0.5)',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                        animation: 'shimmer 2s infinite',
                      }}
                    />
                  </motion.div>
                </div>

                {/* Sheet Progress List */}
                <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                  {selectedSheets.slice(0, importProgress.currentSheetIndex + 1).map((sheetName, idx) => {
                    const sheet = previewData.available_sheets.find(s => s.excel_name === sheetName);
                    const isCompleted = idx < importProgress.currentSheetIndex;
                    const isCurrent = idx === importProgress.currentSheetIndex;

                    return (
                      <div
                        key={sheetName}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 12px',
                          borderRadius: 10,
                          background: isCompleted ? 'rgba(16,185,129,0.12)' : isCurrent ? 'rgba(99,102,241,0.12)' : 'rgba(148,163,184,0.08)',
                          border: `1px solid ${isCompleted ? 'rgba(16,185,129,0.3)' : isCurrent ? 'rgba(99,102,241,0.3)' : 'rgba(148,163,184,0.15)'}`,
                        }}
                      >
                        {isCompleted ? (
                          <CheckCircle2 style={{ width: 14, height: 14, color: '#34d399', flexShrink: 0 }} />
                        ) : isCurrent ? (
                          <RefreshCw style={{ width: 14, height: 14, color: '#818cf8', flexShrink: 0 }} className="spin" />
                        ) : (
                          <Clock style={{ width: 14, height: 14, color: '#64748b', flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: 11, fontWeight: 700, color: isCompleted ? '#34d399' : isCurrent ? '#818cf8' : '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sheet?.display_name || sheetName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 19, fontWeight: 800, color: '#fff', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 10, letterSpacing: '-0.01em' }}>
                <FileText style={{ width: 22, height: 22, color: '#34d399' }} />
                جميع الورقات في الملف ({previewData.total_sheets} ورقة)
              </h2>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
                {previewData.registered_sheets_count} ورقة مسجلة في النظام
                {previewData.unregistered_sheets_count && previewData.unregistered_sheets_count > 0 && (
                  <> • <span style={{ color: '#fbbf24' }}>{previewData.unregistered_sheets_count} ورقة جديدة سيتم استيرادها بشكل ذكي</span></>
                )}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, marginBottom: 24 }}>
              {previewData.available_sheets.map((sheet) => (
                <div
                  key={sheet.excel_name}
                  onClick={() => toggleSheet(sheet.excel_name)}
                  className="glass-card glass-card-hover"
                  style={{
                    padding: '16px 18px',
                    borderRadius: 14,
                    background: selectedSheets.includes(sheet.excel_name) ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.04)',
                    border: selectedSheets.includes(sheet.excel_name) ? '2px solid #34d399' : sheet.is_registered ? '1px solid rgba(148,163,184,0.12)' : '1px solid rgba(251,191,36,0.3)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{sheet.display_name}</span>
                      {!sheet.is_registered && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', padding: '2px 6px', borderRadius: 6, background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)' }}>
                          جديدة
                        </span>
                      )}
                    </div>
                    {selectedSheets.includes(sheet.excel_name) && (
                      <CheckCircle2 style={{ width: 18, height: 18, color: '#34d399' }} />
                    )}
                  </div>
                  <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px', lineHeight: 1.5 }}>{sheet.description}</p>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.15)' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1' }}>{sheet.row_count} صف</span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, paddingTop: 20, borderTop: '1px solid rgba(148,163,184,0.1)', flexWrap: 'wrap' }}>
              <button
                onClick={() => setSelectedSheets(previewData.available_sheets.map(s => s.excel_name))}
                className="btn-ghost"
                style={{ padding: '10px 18px', borderRadius: 10, fontSize: 14, fontWeight: 700 }}
              >
                اختيار الكل
              </button>
              <button
                onClick={() => setSelectedSheets([])}
                className="btn-ghost"
                style={{ padding: '10px 18px', borderRadius: 10, fontSize: 14, fontWeight: 700 }}
              >
                إلغاء الكل
              </button>
              <div style={{ flex: 1 }} />
              <button
                onClick={handleImport}
                disabled={importing || selectedSheets.length === 0}
                className="btn-primary"
                style={{ 
                  padding: '12px 28px', 
                  borderRadius: 12, 
                  fontSize: 14, 
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  opacity: importing || selectedSheets.length === 0 ? 0.5 : 1 
                }}
              >
                {importing ? (
                  <>
                    <RefreshCw style={{ width: 18, height: 18 }} className="spin" />
                    <span>جاري الاستيراد...</span>
                  </>
                ) : (
                  <>
                    <Download style={{ width: 18, height: 18 }} />
                    <span>استيراد {selectedSheets.length} ورقة</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* Import Results */}
        {importResult && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card"
            style={{ borderRadius: 16, padding: '2rem' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              {importResult.success ? (
                <CheckCircle2 style={{ width: 28, height: 28, color: '#34d399' }} />
              ) : (
                <AlertTriangle style={{ width: 28, height: 28, color: '#fb7185' }} />
              )}
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.01em' }}>
                نتيجة الاستيراد
              </h2>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
              <div className="glass-card" style={{ padding: '18px', borderRadius: 14, background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)' }}>
                <div style={{ fontSize: 32, fontWeight: 900, color: '#34d399', marginBottom: 6, letterSpacing: '-0.02em' }}>
                  {importResult.summary.total_new_employees}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>موظف جديد</div>
              </div>

              <div className="glass-card" style={{ padding: '18px', borderRadius: 14, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)' }}>
                <div style={{ fontSize: 32, fontWeight: 900, color: '#818cf8', marginBottom: 6, letterSpacing: '-0.02em' }}>
                  {importResult.summary.total_updated_employees}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>موظف محدث</div>
              </div>

              <div className="glass-card" style={{ padding: '18px', borderRadius: 14, background: 'rgba(251,113,133,0.12)', border: '1px solid rgba(251,113,133,0.3)' }}>
                <div style={{ fontSize: 32, fontWeight: 900, color: '#fb7185', marginBottom: 6, letterSpacing: '-0.02em' }}>
                  {importResult.summary.total_skipped_rows}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>صف متخطى</div>
              </div>

              <div className="glass-card" style={{ padding: '18px', borderRadius: 14, background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.3)' }}>
                <div style={{ fontSize: 32, fontWeight: 900, color: '#cbd5e1', marginBottom: 6, letterSpacing: '-0.02em' }}>
                  {importResult.summary.sheets_success}/{importResult.summary.total_sheets_imported}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>ورقة ناجحة بالكامل{(importResult.summary.sheets_partial || 0) > 0 ? ` (+${importResult.summary.sheets_partial} جزئيًا)` : ''}</div>
              </div>

              <div className="glass-card" style={{ padding: '18px', borderRadius: 14, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)' }}>
                <div style={{ fontSize: 32, fontWeight: 900, color: '#fbbf24', marginBottom: 6, letterSpacing: '-0.02em' }}>
                  {(importResult.summary.total_errors || 0) + (importResult.summary.total_cross_account_conflicts || 0)}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>خطأ/تعارض يحتاج مراجعة</div>
              </div>
            </div>

            <p style={{ fontSize: 15, color: '#e2e8f0', padding: '16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.1)', lineHeight: 1.6 }}>
              {importResult.message}
            </p>

            {/* Per-sheet errors and cross-account conflicts — visible, never
                silently "successful". A partial import is not a full snapshot. */}
            {(() => {
              const errs = Object.entries(importResult.detailed_results || {})
                .flatMap(([sheet, r]) => (r.errors || []).map((e) => ({ sheet, e })));
              const xconf = Object.entries(importResult.detailed_results || {})
                .flatMap(([sheet, r]) => (r.cross_account_conflicts || []).map((c) => ({ sheet, c })));
              if (errs.length === 0 && xconf.length === 0) return null;
              return (
                <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 12, background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.35)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <AlertTriangle style={{ width: 15, height: 15, color: '#fb7185' }} />
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#fb7185' }}>صفوف لم تُستورد وتحتاج مراجعة ({errs.length + xconf.length})</span>
                  </div>
                  {errs.map((x, i) => (
                    <p key={`e${i}`} style={{ fontSize: 12, color: '#fecdd3', margin: '0 0 4px', lineHeight: 1.6 }}>• [{x.sheet}] {x.e}</p>
                  ))}
                  {xconf.map((x, i) => (
                    <p key={`c${i}`} style={{ fontSize: 12, color: '#fecdd3', margin: '0 0 4px', lineHeight: 1.6 }}>• [{x.sheet}] تعارض حسابات: {x.c.employee_name || x.c.national_id || 'صف'} — السجل الحالي {x.c.master_account || ''} والصف {x.c.row_account || ''}؛ لم يُنقل تلقائيًا</p>
                  ))}
                </div>
              );
            })()}

            {/* Non-fatal import warnings (e.g. same-file duplicate rows with
                different values) — visible, never silently "verified". */}
            {(() => {
              const warns = Object.entries(importResult.detailed_results || {})
                .flatMap(([sheet, r]) => (r.warnings || []).map((w) => ({ sheet, w })));
              if (warns.length === 0) return null;
              return (
                <div style={{ marginTop: 16, padding: '14px 16px', borderRadius: 12, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <AlertTriangle style={{ width: 15, height: 15, color: '#fbbf24' }} />
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>تحذيرات تحتاج مراجعة ({warns.length})</span>
                  </div>
                  {warns.map((x, i) => (
                    <p key={i} style={{ fontSize: 12, color: '#fde68a', margin: '0 0 4px', lineHeight: 1.6 }}>• [{x.sheet}] {x.w}</p>
                  ))}
                </div>
              );
            })()}
          </motion.div>
        )}
      </main>
    </div>
  );
}
