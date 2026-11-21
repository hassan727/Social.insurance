'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Sparkles,
  Download,
  RefreshCw,
  Search,
  ShieldCheck,
  AlertTriangle,
  Building2,
  Layers,
  FileSpreadsheet,
  CheckCircle2,
  Users,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Database,
  FileCheck2,
  HeartPulse,
  CreditCard,
  UserX,
} from 'lucide-react';
import Link from 'next/link';

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  category?: 'cross_sheet' | 'standard';
  icon?: string;
  query?: Record<string, unknown>;
}

interface QueryResult {
  success: boolean;
  data: Record<string, unknown>[];
  total_count: number;
  columns: string[];
  query_info: {
    company_account: string;
    sheets_included: string[];
    filters_applied: number;
  };
}

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  uninsured_active: <AlertTriangle style={{ width: 18, height: 18, color: '#f59e0b' }} />,
  archives_completeness: <FileCheck2 style={{ width: 18, height: 18, color: '#38bdf8' }} />,
  medical_and_111: <HeartPulse style={{ width: 18, height: 18, color: '#ec4899' }} />,
  discrepancy_and_alerts: <AlertTriangle style={{ width: 18, height: 18, color: '#ef4444' }} />,
  bank_and_deductions: <CreditCard style={{ width: 18, height: 18, color: '#10b981' }} />,
  active_resigned_conflict: <UserX style={{ width: 18, height: 18, color: '#f97316' }} />,
  all_employees: <Users style={{ width: 18, height: 18, color: '#818cf8' }} />,
  insured_employees: <ShieldCheck style={{ width: 18, height: 18, color: '#10b981' }} />,
  resigned_employees: <UserX style={{ width: 18, height: 18, color: '#94a3b8' }} />,
  new_employees: <Sparkles style={{ width: 18, height: 18, color: '#38bdf8' }} />,
};

const COLUMN_LABELS: Record<string, string> = {
  employee_code: 'كود الأداء',
  employee_name: 'اسم الموظف',
  national_id: 'الرقم القومي',
  company_account: 'حساب الشركة',
  current_status: 'الحالة',
  current_job_title: 'الوظيفة',
  current_region: 'المنطقة',
  current_department: 'الإدارة',
  hire_date: 'تاريخ التعيين',
  insurance_number: 'الرقم التأميني',
  insurance_status: 'الحالة التأمينية',
  insurance_salary: 'الأجر التأميني',
  resignation_date: 'تاريخ الاستقالة',
  last_working_day: 'آخر يوم عمل',
  phone_number: 'رقم الهاتف',
  address: 'العنوان',
};

function formatHeader(key: string): string {
  if (COLUMN_LABELS[key]) return COLUMN_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/^([A-Za-z\s]+)_/, '$1: ');
}

export default function CrossSheetReportsView() {
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('uninsured_active');
  const [account, setAccount] = useState<'E.G' | 'm.g' | 'ALL'>('ALL');
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportResult, setReportResult] = useState<QueryResult | null>(null);

  // Search & Pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  // Load Templates List
  useEffect(() => {
    async function loadTemplates() {
      try {
        const res = await fetch('/api/dynamic-reports/templates');
        if (res.ok) {
          const json = await res.json();
          if (json.templates) {
            setTemplates(json.templates);
          }
        }
      } catch (e) {
        console.error('Failed to load templates:', e);
      }
    }
    loadTemplates();
  }, []);

  // Fetch Report Data
  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Find template
      const template = templates.find((t) => t.id === selectedTemplateId);
      const queryPayload = template
        ? { ...template.query, company_account: account, limit: 1000 }
        : { company_account: account, limit: 1000 };

      const res = await fetch('/api/dynamic-reports/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queryPayload),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'فشل استدعاء التقرير');
      }

      const json: QueryResult = await res.json();
      setReportResult(json);
      setCurrentPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء تحميل التقرير');
    } finally {
      setLoading(false);
    }
  }, [selectedTemplateId, account, templates]);

  // Trigger fetch when template or account changes
  useEffect(() => {
    if (templates.length > 0) {
      fetchReport();
    }
  }, [fetchReport, templates.length]);

  // Handle Excel Export
  const handleExport = async () => {
    setExporting(true);
    try {
      const template = templates.find((t) => t.id === selectedTemplateId);
      const queryPayload = template
        ? {
            ...template.query,
            company_account: account,
            report_title: template.name,
            report_type: 'excel',
            limit: 5000,
          }
        : {
            company_account: account,
            report_title: 'تقرير مخصص',
            report_type: 'excel',
            limit: 5000,
          };

      const res = await fetch('/api/dynamic-reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(queryPayload),
      });

      if (!res.ok) {
        throw new Error('فشل تصدير ملف الإكسيل');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template?.id || 'report'}_${account}_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'خطأ في التصدير');
    } finally {
      setExporting(false);
    }
  };

  // Filtered rows for client search
  const filteredRows = useMemo(() => {
    if (!reportResult?.data) return [];
    if (!searchQuery.trim()) return reportResult.data;

    const q = searchQuery.toLowerCase().trim();
    return reportResult.data.filter((row) =>
      Object.values(row).some((val) =>
        val !== null && val !== undefined && String(val).toLowerCase().includes(q)
      )
    );
  }, [reportResult, searchQuery]);

  // Paginated rows
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;

  const activeTemplate = templates.find((t) => t.id === selectedTemplateId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* ── Top Innovative Banner ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: 20,
          padding: '1.5rem 1.75rem',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -40,
            left: -40,
            width: 180,
            height: 180,
            background: 'radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, transparent 70%)',
            pointerEvents: 'none',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 9999, background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontSize: '0.75rem', fontWeight: 800, marginBottom: 8 }}>
              <Database style={{ width: 14, height: 14 }} />
              منظومة الـ 13 شيت الموحدة (Cross-Sheet Intelligence)
            </div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 6px 0' }}>
              تقارير الربط الذكي والرادار الرقابي الموحد
            </h2>
            <p style={{ fontSize: '0.86rem', color: '#94a3b8', margin: 0, maxWidth: 680 }}>
              استخراج البيانات المتقاطعة بين ملفات الأرشيف، الكشف الطبي، شيت المناقضات، الحسابات البنكية، والتأمينات للكشف عن الثغرات بدون الحاجة لفحص كل ملف يدوياً.
            </p>
          </div>

          {/* Quick Metrics */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ padding: '10px 16px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(148, 163, 184, 0.15)', borderRadius: 12, textAlign: 'center' }}>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>إجمالي السجلات المستدعاة</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#38bdf8' }}>
                {reportResult?.total_count ? reportResult.total_count.toLocaleString('ar-EG') : '0'}
              </div>
            </div>

            <div style={{ padding: '10px 16px', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(148, 163, 184, 0.15)', borderRadius: 12, textAlign: 'center' }}>
              <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>نتائج البحث الحالي</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#10b981' }}>
                {filteredRows.length.toLocaleString('ar-EG')}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Templates Selector Carousel / Grid ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', fontWeight: 700, color: '#cbd5e1' }}>
          <Layers style={{ width: 16, height: 16, color: '#818cf8' }} />
          اختر قالب التقرير الذكي:
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
          {templates.map((tpl) => {
            const isSelected = tpl.id === selectedTemplateId;
            const icon = TEMPLATE_ICONS[tpl.id] || <FileSpreadsheet style={{ width: 18, height: 18, color: '#818cf8' }} />;

            return (
              <div
                key={tpl.id}
                onClick={() => setSelectedTemplateId(tpl.id)}
                style={{
                  padding: '12px 14px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  background: isSelected
                    ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.18) 0%, rgba(99, 102, 241, 0.18) 100%)'
                    : 'rgba(15, 23, 42, 0.6)',
                  border: isSelected
                    ? '1.5px solid #38bdf8'
                    : '1px solid rgba(148, 163, 184, 0.12)',
                  boxShadow: isSelected ? '0 0 16px rgba(56, 189, 248, 0.25)' : 'none',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div
                    style={{
                      padding: 8,
                      borderRadius: 10,
                      background: isSelected ? 'rgba(56, 189, 248, 0.2)' : 'rgba(30, 41, 59, 0.8)',
                    }}
                  >
                    {icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 800, color: isSelected ? '#38bdf8' : '#f1f5f9', marginBottom: 2 }}>
                      {tpl.name}
                    </div>
                    <div
                      style={{
                        fontSize: '0.74rem',
                        color: '#94a3b8',
                        lineHeight: 1.35,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                      title={tpl.description}
                    >
                      {tpl.description}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Control Bar: Filters & Actions ── */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(148, 163, 184, 0.15)',
          borderRadius: 16,
          padding: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flex: 1 }}>
          {/* Account Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Building2 style={{ width: 16, height: 16, color: '#94a3b8' }} />
            <select
              value={account}
              onChange={(e) => setAccount(e.target.value as 'E.G' | 'm.g' | 'ALL')}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                color: '#fff',
                fontSize: '0.85rem',
                fontWeight: 700,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="ALL">🌐 جميع الحسابات (E.G + m.g)</option>
              <option value="E.G">🏢 Egypt Gas (E.G)</option>
              <option value="m.g">🏢 Modern Gas (m.g)</option>
            </select>
          </div>

          {/* Search Box */}
          <div style={{ position: 'relative', minWidth: 260, flex: 1, maxWidth: 420 }}>
            <Search
              style={{
                position: 'absolute',
                right: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 16,
                height: 16,
                color: '#64748b',
              }}
            />
            <input
              type="text"
              placeholder="ابحث بالاسم، الكود، الرقم القومي، الإدارة..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                width: '100%',
                padding: '8px 38px 8px 12px',
                borderRadius: 10,
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                color: '#fff',
                fontSize: '0.85rem',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={fetchReport}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 10,
              background: 'rgba(56, 189, 248, 0.12)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              fontSize: '0.85rem',
              fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw style={{ width: 14, height: 14, animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            تحديث
          </button>

          <button
            onClick={handleExport}
            disabled={exporting || !reportResult?.data?.length}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 10,
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              border: 'none',
              color: '#fff',
              fontSize: '0.85rem',
              fontWeight: 800,
              cursor: exporting || !reportResult?.data?.length ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
            }}
          >
            <Download style={{ width: 15, height: 15 }} />
            {exporting ? 'جاري التصدير...' : 'تصدير إكسيل (Excel)'}
          </button>
        </div>
      </div>

      {/* ── Active Template Description & Meta ── */}
      {activeTemplate && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: 12,
            background: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: '0.82rem',
            color: '#cbd5e1',
          }}
        >
          <Sparkles style={{ width: 16, height: 16, color: '#38bdf8', flexShrink: 0 }} />
          <span>
            <strong>{activeTemplate.name}:</strong> {activeTemplate.description}
          </span>
        </div>
      )}

      {/* ── Error Notice ── */}
      {error && (
        <div
          style={{
            padding: '1rem',
            borderRadius: 12,
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#f87171',
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertTriangle style={{ width: 18, height: 18 }} />
          <span>{error}</span>
        </div>
      )}

      {/* ── Data Table Container ── */}
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(148, 163, 184, 0.15)',
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
        }}
      >
        <div style={{ overflowX: 'auto', maxHeight: '680px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'rgba(30, 41, 59, 0.95)', borderBottom: '2px solid rgba(148, 163, 184, 0.2)', position: 'sticky', top: 0, zIndex: 10 }}>
                <th style={{ padding: '12px 14px', color: '#94a3b8', fontWeight: 800, width: 60, textAlign: 'center' }}>#</th>
                {reportResult?.columns.map((col) => (
                  <th
                    key={col}
                    style={{
                      padding: '12px 14px',
                      color: '#f1f5f9',
                      fontWeight: 800,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatHeader(col)}
                  </th>
                ))}
                <th style={{ padding: '12px 14px', color: '#38bdf8', fontWeight: 800, textAlign: 'center' }}>
                  ملف الموظف 360°
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={(reportResult?.columns.length || 0) + 2} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                      <RefreshCw style={{ width: 28, height: 28, color: '#38bdf8', animation: 'spin 1s linear infinite' }} />
                      <span>جاري تشغيل استعلام الربط الذكي واستخراج السجلات...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={(reportResult?.columns.length || 0) + 2} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <CheckCircle2 style={{ width: 32, height: 32, color: '#10b981' }} />
                      <span style={{ fontWeight: 700, color: '#f1f5f9' }}>لا توجد سجلات مطابقة للمعايير المحددة</span>
                      <span style={{ fontSize: '0.78rem' }}>قد يعني ذلك اكتمال البيانات أو عدم وجود مخالفات في هذا الرادار</span>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedRows.map((row, idx) => {
                  const rowNumber = (currentPage - 1) * pageSize + idx + 1;
                  const empCode = row.employee_code || row.code || '';

                  return (
                    <tr
                      key={idx}
                      style={{
                        borderBottom: '1px solid rgba(148, 163, 184, 0.08)',
                        background: idx % 2 === 0 ? 'transparent' : 'rgba(30, 41, 59, 0.3)',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '10px 14px', color: '#64748b', textAlign: 'center', fontSize: '0.78rem' }}>
                        {rowNumber}
                      </td>

                      {reportResult?.columns.map((col) => {
                        const val = row[col];
                        let cellContent = val !== null && val !== undefined ? String(val) : '—';

                        // Badge styling for status
                        if (col === 'current_status') {
                          const isAct = String(val).toLowerCase().includes('act') || val === 'Active' || val === '0';
                          return (
                            <td key={col} style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 8px',
                                  borderRadius: 9999,
                                  fontSize: '0.74rem',
                                  fontWeight: 700,
                                  background: isAct ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                  color: isAct ? '#34d399' : '#f87171',
                                }}
                              >
                                {isAct ? 'نشط' : cellContent}
                              </span>
                            </td>
                          );
                        }

                        // Badge styling for insurance status
                        if (col === 'insurance_status') {
                          const isIns = val && String(val).includes('مؤمن');
                          return (
                            <td key={col} style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 8px',
                                  borderRadius: 9999,
                                  fontSize: '0.74rem',
                                  fontWeight: 700,
                                  background: isIns ? 'rgba(56, 189, 248, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                                  color: isIns ? '#38bdf8' : '#fbbf24',
                                }}
                              >
                                {cellContent}
                              </span>
                            </td>
                          );
                        }

                        return (
                          <td
                            key={col}
                            style={{
                              padding: '10px 14px',
                              color: col === 'employee_name' ? '#f8fafc' : '#cbd5e1',
                              fontWeight: col === 'employee_name' ? 700 : 400,
                              whiteSpace: 'nowrap',
                              maxWidth: 240,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={String(val || '')}
                          >
                            {cellContent}
                          </td>
                        );
                      })}

                      {/* Link to 360 Unified Profile */}
                      <td style={{ padding: '10px 14px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {empCode ? (
                          <Link
                            href={`/lookup?q=${encodeURIComponent(String(empCode))}`}
                            target="_blank"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '3px 8px',
                              borderRadius: 8,
                              background: 'rgba(56, 189, 248, 0.15)',
                              color: '#38bdf8',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              textDecoration: 'none',
                              border: '1px solid rgba(56, 189, 248, 0.3)',
                            }}
                          >
                            <ExternalLink style={{ width: 12, height: 12 }} />
                            عرض الملف
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination Footer ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            background: 'rgba(30, 41, 59, 0.8)',
            borderTop: '1px solid rgba(148, 163, 184, 0.15)',
            flexWrap: 'wrap',
            gap: '0.75rem',
            fontSize: '0.82rem',
            color: '#94a3b8',
          }}
        >
          <div>
            عرض {paginatedRows.length} من إجمالي {filteredRows.length} سجل
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                color: currentPage === 1 ? '#64748b' : '#f1f5f9',
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                fontSize: '0.8rem',
              }}
            >
              <ChevronRight style={{ width: 14, height: 14 }} />
              السابق
            </button>

            <span style={{ fontWeight: 700, color: '#f1f5f9', padding: '0 6px' }}>
              صفحة {currentPage} من {totalPages}
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 8,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(148, 163, 184, 0.2)',
                color: currentPage === totalPages ? '#64748b' : '#f1f5f9',
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                fontSize: '0.8rem',
              }}
            >
              التالي
              <ChevronLeft style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
