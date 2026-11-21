'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet, Filter, Download, Save, Play, RefreshCw,
  Plus, Trash2, CheckCircle2, ChevronRight, Layers, Table,
  Database, Shield, Calendar, Bookmark, BookmarkCheck
} from 'lucide-react';
import { toast } from 'sonner';

interface FilterRow {
  field: string;
  operator: 'eq' | 'neq' | 'like' | 'gt' | 'lt' | 'is_null' | 'is_not_null';
  value: string;
}

interface SavedReport {
  id: string;
  report_name: string;
  report_description: string | null;
  report_config: any;
  created_at: string;
}

const AVAILABLE_FIELDS = [
  { key: 'employee_code', label: 'كود الموظف', group: 'المعلومات الأساسية' },
  { key: 'national_id', label: 'الرقم القومي', group: 'المعلومات الأساسية' },
  { key: 'employee_name', label: 'اسم الموظف', group: 'المعلومات الأساسية' },
  { key: 'company_account', label: 'الحساب (Account)', group: 'المعلومات الأساسية' },
  { key: 'current_status', label: 'الحالة الوظيفية', group: 'المعلومات الأساسية' },
  { key: 'current_job_title', label: 'الوظيفة الحالية', group: 'المعلومات الوظيفية' },
  { key: 'current_department', label: 'الإدارة', group: 'المعلومات الوظيفية' },
  { key: 'current_region', label: 'المنطقة / الفرع', group: 'المعلومات الوظيفية' },
  { key: 'hire_date', label: 'تاريخ الاستلام', group: 'المعلومات الوظيفية' },
  { key: 'resignation_date', label: 'تاريخ الاستقالة', group: 'المعلومات الوظيفية' },
  { key: 'insurance_number', label: 'الرقم التأميني', group: 'التأمينات' },
  { key: 'insurance_status', label: 'الحالة التأمينية', group: 'التأمينات' },
  { key: 'insurance_salary', label: 'الأجر التأميني', group: 'التأمينات' },
  { key: 'insurance_start_date', label: 'تاريخ بداية التأمين', group: 'التأمينات' },
  { key: 'insurance_job_title', label: 'الوظيفة بالتأمينات', group: 'التأمينات' },
  { key: 'bank_account_number', label: 'الحساب البنكي', group: 'المالية' },
  { key: 'bank_name', label: 'اسم البنك', group: 'المالية' },
  { key: 'medical_exam_status', label: 'الكشف الطبي', group: 'الملف والأرشيف' },
  { key: 'archive_status', label: 'حالة الأرشيف', group: 'الملف والأرشيف' },
  { key: 'phone_number', label: 'رقم الهاتف', group: 'الاتصال' },
];

export default function ReportBuilderPage() {
  const [account, setAccount] = useState<'ALL' | 'E.G' | 'm.g'>('ALL');
  const [selectedFields, setSelectedFields] = useState<string[]>([
    'employee_code', 'employee_name', 'company_account', 'current_status',
    'current_job_title', 'insurance_number', 'insurance_status'
  ]);
  const [filters, setFilters] = useState<FilterRow[]>([
    { field: 'current_status', operator: 'eq', value: 'Active' }
  ]);
  const [reportTitle, setReportTitle] = useState('تقرير مخصص جديد');
  const [results, setResults] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [showSavedModal, setShowSavedModal] = useState(false);

  const fetchSavedReports = useCallback(async () => {
    try {
      const res = await fetch('/api/saved-reports');
      const json = await res.json();
      if (res.ok) setSavedReports(json.reports || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSavedReports();
  }, [fetchSavedReports]);

  const toggleField = (fieldKey: string) => {
    setSelectedFields((prev) =>
      prev.includes(fieldKey)
        ? prev.filter((k) => k !== fieldKey)
        : [...prev, fieldKey]
    );
  };

  const addFilter = () => {
    setFilters((prev) => [...prev, { field: 'current_status', operator: 'eq', value: '' }]);
  };

  const removeFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  };

  const updateFilter = (index: number, patch: Partial<FilterRow>) => {
    setFilters((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );
  };

  const runQuery = async () => {
    if (selectedFields.length === 0) {
      toast.error('يرجى اختيار عمود واحد على الأقل');
      return;
    }

    setLoading(true);
    try {
      const payloadFilters = filters
        .filter((f) => f.field && (f.operator === 'is_null' || f.operator === 'is_not_null' || f.value))
        .map((f) => ({
          field: f.field,
          operator: f.operator,
          value: f.operator === 'is_null' || f.operator === 'is_not_null' ? undefined : f.value,
        }));

      const res = await fetch('/api/dynamic-reports/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_account: account,
          master_columns: selectedFields,
          filters: payloadFilters,
          limit: 200,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل تشغيل التقرير');

      setResults(json.data || []);
      setTotalCount(json.total_count || (json.data ? json.data.length : 0));
      toast.success(`تم استرجاع ${json.data?.length || 0} سجل`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء تشغيل التقرير');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (selectedFields.length === 0) {
      toast.error('يرجى اختيار أعمدة للتصدير');
      return;
    }

    setExporting(true);
    try {
      const payloadFilters = filters
        .filter((f) => f.field && (f.operator === 'is_null' || f.operator === 'is_not_null' || f.value))
        .map((f) => ({
          field: f.field,
          operator: f.operator,
          value: f.value,
        }));

      const res = await fetch('/api/dynamic-reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_title: reportTitle,
          company_account: account,
          master_columns: selectedFields,
          filters: payloadFilters,
          limit: 10000,
        }),
      });

      if (!res.ok) throw new Error('فشل تصدير ملف الإكسيل');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${reportTitle}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success('تم تصدير ملف الإكسيل بنجاح');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء التصدير');
    } finally {
      setExporting(false);
    }
  };

  const handleSaveReport = async () => {
    if (!reportTitle.trim()) {
      toast.error('يرجى إدخال اسم للتقرير');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/saved-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report_name: reportTitle,
          report_config: {
            company_account: account,
            selected_fields: selectedFields,
            filters,
          },
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'فشل حفظ التقرير');

      toast.success('تم حفظ التقرير بنجاح');
      fetchSavedReports();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const loadSavedReport = (saved: SavedReport) => {
    const config = saved.report_config || {};
    setReportTitle(saved.report_name);
    if (config.company_account) setAccount(config.company_account);
    if (config.selected_fields) setSelectedFields(config.selected_fields);
    if (config.filters) setFilters(config.filters);
    setShowSavedModal(false);
    toast.success(`تم تحميل التقرير: ${saved.report_name}`);
  };

  return (
    <div style={{ paddingBottom: 60 }}>
      <main style={{ maxWidth: 1440, margin: '0 auto', padding: '32px 24px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileSpreadsheet style={{ width: 22, height: 22, color: '#818cf8' }} />
            </div>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 900, margin: 0, color: '#ffffff' }}>
                مصنع ومصمم التقارير الديناميكي (Dynamic Report Builder)
              </h1>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 0' }}>
                بناء وتخصيص استعلامات وتقارير مركبة بدون أكواد مع تصدير مباشر لإكسيل وحفظ التكوينات
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => setShowSavedModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 16px',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#e2e8f0',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <Bookmark style={{ width: 15, height: 15, color: '#818cf8' }} />
              التقارير المحفوظة ({savedReports.length})
            </button>

            <button
              type="button"
              onClick={handleSaveReport}
              disabled={saving}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 16px',
                borderRadius: 10,
                background: 'rgba(99,102,241,0.15)',
                border: '1px solid rgba(99,102,241,0.3)',
                color: '#a5b4fc',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              <Save style={{ width: 15, height: 15 }} />
              حفظ الإعدادات
            </button>
          </div>
        </div>

        {/* Builder Controls Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: 24, marginBottom: 28 }}>
          {/* Left Panel: Report Config & Column Selection */}
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 20 }}>
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 800, color: '#cbd5e1', display: 'block', marginBottom: 6 }}>
                عنوان التقرير
              </label>
              <input
                type="text"
                value={reportTitle}
                onChange={(e) => setReportTitle(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(15,23,42,0.6)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10,
                  padding: '9px 12px',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 700,
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 800, color: '#cbd5e1', display: 'block', marginBottom: 6 }}>
                الحساب المستهدف (Account)
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {(['ALL', 'E.G', 'm.g'] as const).map((acc) => (
                  <button
                    key={acc}
                    type="button"
                    onClick={() => setAccount(acc)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: account === acc ? '1px solid #6366f1' : '1px solid rgba(255,255,255,0.08)',
                      background: account === acc ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.03)',
                      color: account === acc ? '#ffffff' : '#94a3b8',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {acc === 'ALL' ? 'الكل (E.G + m.g)' : acc}
                  </button>
                ))}
              </div>
            </div>

            {/* Column Selector */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <label style={{ fontSize: 12, fontWeight: 800, color: '#cbd5e1' }}>
                  الأعمدة المعروضة ({selectedFields.length} مختارة)
                </label>
                <button
                  type="button"
                  onClick={() => setSelectedFields(AVAILABLE_FIELDS.map((f) => f.key))}
                  style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >
                  تحديد الكل
                </button>
              </div>

              <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 4 }}>
                {AVAILABLE_FIELDS.map((field) => {
                  const isChecked = selectedFields.includes(field.key);
                  return (
                    <label
                      key={field.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '7px 10px',
                        borderRadius: 8,
                        background: isChecked ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${isChecked ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)'}`,
                        cursor: 'pointer',
                        fontSize: 12,
                        userSelect: 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleField(field.key)}
                          style={{ cursor: 'pointer', accentColor: '#6366f1' }}
                        />
                        <span style={{ fontWeight: isChecked ? 700 : 500, color: isChecked ? '#ffffff' : '#94a3b8' }}>
                          {field.label}
                        </span>
                      </div>
                      <span style={{ fontSize: 10, color: '#64748b' }}>{field.group}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Panel: Filter Builder & Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 20, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Filter style={{ width: 16, height: 16, color: '#38bdf8' }} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: '#ffffff' }}>شروط وفلاتر الاستعلام</span>
                </div>
                <button
                  type="button"
                  onClick={addFilter}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '5px 12px',
                    borderRadius: 8,
                    background: 'rgba(56,189,248,0.15)',
                    border: '1px solid rgba(56,189,248,0.3)',
                    color: '#38bdf8',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <Plus style={{ width: 14, height: 14 }} /> إضافة شرط
                </button>
              </div>

              {filters.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: '#64748b', fontSize: 13 }}>
                  لا توجد فلاتر مخصصة (سيتم استرجاع كل البيانات)
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {filters.map((f, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.4fr 1.2fr 2fr auto',
                        gap: 8,
                        alignItems: 'center',
                        background: 'rgba(15,23,42,0.5)',
                        padding: '8px 10px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.05)',
                      }}
                    >
                      <select
                        value={f.field}
                        onChange={(e) => updateFilter(idx, { field: e.target.value })}
                        style={{
                          background: '#090d16',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 8,
                          padding: '6px 8px',
                          color: '#e2e8f0',
                          fontSize: 12,
                          outline: 'none',
                        }}
                      >
                        {AVAILABLE_FIELDS.map((af) => (
                          <option key={af.key} value={af.key}>{af.label}</option>
                        ))}
                      </select>

                      <select
                        value={f.operator}
                        onChange={(e) => updateFilter(idx, { operator: e.target.value as any })}
                        style={{
                          background: '#090d16',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 8,
                          padding: '6px 8px',
                          color: '#e2e8f0',
                          fontSize: 12,
                          outline: 'none',
                        }}
                      >
                        <option value="eq">يساوي (=)</option>
                        <option value="neq">لا يساوي (≠)</option>
                        <option value="like">يحتوي على</option>
                        <option value="gt">أكبر من (&gt;)</option>
                        <option value="lt">أصغر من (&lt;)</option>
                        <option value="is_null">فارغ (Null)</option>
                        <option value="is_not_null">غير فارغ</option>
                      </select>

                      {f.operator !== 'is_null' && f.operator !== 'is_not_null' ? (
                        <input
                          type="text"
                          value={f.value}
                          placeholder="القيمة المطلوبة..."
                          onChange={(e) => updateFilter(idx, { value: e.target.value })}
                          style={{
                            background: '#090d16',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: 8,
                            padding: '6px 10px',
                            color: '#ffffff',
                            fontSize: 12,
                            outline: 'none',
                          }}
                        />
                      ) : (
                        <div style={{ color: '#64748b', fontSize: 11 }}>— بدون قيمة —</div>
                      )}

                      <button
                        type="button"
                        onClick={() => removeFilter(idx)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ef4444',
                          cursor: 'pointer',
                          padding: 4,
                        }}
                      >
                        <Trash2 style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Run & Export Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
              <button
                type="button"
                onClick={runQuery}
                disabled={loading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 24px',
                  borderRadius: 12,
                  background: '#6366f1',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                  boxShadow: '0 4px 14px rgba(99,102,241,0.3)',
                }}
              >
                <Play style={{ width: 16, height: 16, fill: '#fff' }} />
                {loading ? 'جارٍ الاستعلام...' : 'تشغيل الاستعلام وعرض النتائج'}
              </button>

              <button
                type="button"
                onClick={handleExport}
                disabled={exporting}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '12px 20px',
                  borderRadius: 12,
                  background: 'rgba(16,185,129,0.15)',
                  border: '1px solid rgba(16,185,129,0.3)',
                  color: '#34d399',
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: exporting ? 'not-allowed' : 'pointer',
                  opacity: exporting ? 0.7 : 1,
                }}
              >
                <Download style={{ width: 16, height: 16 }} />
                {exporting ? 'جارٍ التصدير...' : 'تصدير إكسيل'}
              </button>
            </div>
          </div>
        </div>

        {/* Results Table */}
        <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 18, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Table style={{ width: 18, height: 18, color: '#818cf8' }} />
              <h3 style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', margin: 0 }}>
                معاينة نتائج الاستعلام ({totalCount} سجل)
              </h3>
            </div>
            {results.length > 0 && (
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                معروض أول {results.length} صف
              </span>
            )}
          </div>

          {results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#64748b' }}>
              <Database style={{ width: 40, height: 40, margin: '0 auto 12px', opacity: 0.4 }} />
              <p style={{ fontSize: 14, margin: 0 }}>اضغط على "تشغيل الاستعلام" لعرض البيانات</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(15,23,42,0.8)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <th style={{ padding: '12px 14px', textAlign: 'right', color: '#94a3b8', fontWeight: 800, width: 40 }}>#</th>
                    {selectedFields.map((fieldKey) => {
                      const f = AVAILABLE_FIELDS.find((x) => x.key === fieldKey);
                      return (
                        <th key={fieldKey} style={{ padding: '12px 14px', textAlign: 'right', color: '#e2e8f0', fontWeight: 800, whiteSpace: 'nowrap' }}>
                          {f?.label || fieldKey}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, idx) => (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                      }}
                    >
                      <td style={{ padding: '10px 14px', color: '#64748b', fontSize: 11, fontFamily: 'monospace' }}>
                        {idx + 1}
                      </td>
                      {selectedFields.map((fieldKey) => {
                        const val = row[fieldKey];
                        const displayVal = val != null ? String(val) : '—';
                        return (
                          <td key={fieldKey} style={{ padding: '10px 14px', color: val ? '#ffffff' : '#64748b', whiteSpace: 'nowrap' }}>
                            {displayVal}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Saved Reports Modal */}
      {showSavedModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, width: '100%', maxWidth: 600, maxHeight: '80vh', overflowY: 'auto', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 style={{ fontSize: 18, fontWeight: 900, color: '#ffffff', margin: 0 }}>
                التقارير المحفوظة ({savedReports.length})
              </h3>
              <button
                type="button"
                onClick={() => setShowSavedModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {savedReports.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#64748b' }}>
                لا توجد تقارير محفوظة بعد. يمكنك حفظ أي تركيبة تقرير باسم مخصص.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {savedReports.map((sr) => (
                  <div
                    key={sr.id}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 14,
                      padding: 16,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#ffffff', marginBottom: 4 }}>
                        {sr.report_name}
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>
                        الحساب: {sr.report_config?.company_account || 'الكل'} | {sr.report_config?.selected_fields?.length || 0} عمود
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => loadSavedReport(sr)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 8,
                        background: '#6366f1',
                        border: 'none',
                        color: '#fff',
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      تحميل وتشغيل
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
