'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  History, Trash2, FileSpreadsheet, RefreshCw, Sparkles,
  CheckCircle2, XCircle, Database, ShieldCheck, TrendingUp,
  AlertTriangle, Calendar, Layers, ArrowRightLeft, ShieldAlert,
  Server, HardDrive, Check, AlertCircle, FileUp
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface ImportLog {
  id: string;
  source_type: string;
  file_name: string;
  sheet_name: string | null;
  period_year: number | null;
  period_month: number | null;
  total_rows_read: number;
  rows_accepted: number;
  rows_rejected: number;
  notes: string | null;
  created_at: string;
}

interface DatabaseStats {
  incoming_insurance: {
    total: number;
    valid_insurance_number: number;
    null_insurance_number: number;
  };
  resignation: {
    total: number;
    with_date: number;
  };
  sheet_data: {
    total: number;
    duplicates_inactive: number;
    active_latest: number;
  };
  employees_master: {
    total: number;
    with_insurance_number: number;
    null_insurance_number: number;
    resigned_count: number;
  };
}

const SOURCE_CFG: Record<string, { label: string; cls: string }> = {
  incoming_insurance: { label: 'أرقام وارد التأمين',    cls: 'badge-brand'   },
  res:                { label: 'ملف RES (الاستقالات)',  cls: 'badge-rose'    },
  monthly_payroll:    { label: 'مرتبات شهرية',          cls: 'badge-violet'  },
  monthly_insurance:  { label: 'تأمينات شهرية',         cls: 'badge-emerald' },
  multi_sheet_import: { label: 'استيراد ذكي متعدد الأوراق (EGYPT GAS)', cls: 'badge-brand' },
};

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState<'tables' | 'logs'>('tables');
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Modal for confirming destructive clear
  const [confirmClear, setConfirmClear] = useState<{
    table: string;
    label: string;
    count: number;
  } | null>(null);

  // Modal for confirming delete import log
  const [confirmDeleteLog, setConfirmDeleteLog] = useState<{
    id: string;
    fileName: string;
  } | null>(null);

  // ─── Fetch All Data ─────────────────────────────────────────────────────────

  const loadData = useCallback(async (showToast = false) => {
    setLoading(true);
    try {
      const [historyRes, controlRes] = await Promise.all([
        fetch('/api/import/history'),
        fetch('/api/database-control'),
      ]);

      const historyData = await historyRes.json();
      const controlData = await controlRes.json();

      if (historyData.success) setLogs(historyData.logs || []);
      if (controlData.success) setStats(controlData.stats);

      if (showToast) toast.success('تم تحديث بيانات قاعدة البيانات بنجاح');
    } catch {
      toast.error('خطأ أثناء تحميل بيانات قاعدة البيانات');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ─── Direct Database Actions (CRUD) ─────────────────────────────────────────

  const handleClearTable = async () => {
    if (!confirmClear) return;
    const { table, label } = confirmClear;
    setConfirmClear(null);
    setActionLoading(`clear_${table}`);
    const tid = toast.loading(`جارٍ مسح جدول ${label}...`);

    try {
      const res = await fetch('/api/database-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_table', table }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || `تم مسح ${label} بنجاح`, { id: tid });
        await loadData();
      } else {
        toast.error(data.error || 'فشلت عملية المسح', { id: tid });
      }
    } catch {
      toast.error('حدث خطأ في الاتصال أثناء المسح', { id: tid });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteImport = async () => {
    if (!confirmDeleteLog) return;
    const { id, fileName } = confirmDeleteLog;
    setConfirmDeleteLog(null);
    setActionLoading(`delete_${id}`);
    const tid = toast.loading(`جارٍ حذف ملف "${fileName}" وسجلاته...`);

    try {
      const res = await fetch('/api/database-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_import', import_id: id }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'تم حذف الملف وسجلاته بنجاح', { id: tid });
        await loadData();
      } else {
        toast.error(data.error || 'فشل حذف الملف', { id: tid });
      }
    } catch {
      toast.error('حدث خطأ أثناء حذف الملف', { id: tid });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSyncIncoming = async () => {
    setActionLoading('sync_incoming');
    const tid = toast.loading('جارٍ مزامنة أرقام وارد التأمين مع سجل الموظفين Master...');
    try {
      const res = await fetch('/api/database-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_incoming_to_master' }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message, { id: tid });
        await loadData();
      } else {
        toast.error(data.error || 'فشلت المزامنة', { id: tid });
      }
    } catch {
      toast.error('حدث خطأ أثناء المزامنة', { id: tid });
    } finally {
      setActionLoading(null);
    }
  };

  const handleSyncResignations = async () => {
    setActionLoading('sync_resignation');
    const tid = toast.loading('جارٍ مزامنة الاستقالات وتحديث حالة الموظفين المستقيلين...');
    try {
      const res = await fetch('/api/database-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_resignation_to_master' }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message, { id: tid });
        await loadData();
      } else {
        toast.error(data.error || 'فشلت المزامنة', { id: tid });
      }
    } catch {
      toast.error('حدث خطأ أثناء مزامنة الاستقالات', { id: tid });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeduplicateSheets = async () => {
    setActionLoading('dedup_sheets');
    const tid = toast.loading('جارٍ تنظيف الصفوف المكررة في شيتات غاز مصر...');
    try {
      const res = await fetch('/api/database-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deduplicate_sheets' }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message, { id: tid });
        await loadData();
      } else {
        toast.error(data.error || 'فشل تنظيف المكررات', { id: tid });
      }
    } catch {
      toast.error('حدث خطأ أثناء تنظيف المكررات', { id: tid });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <main style={{ width: '94%', maxWidth: 1800, margin: '0 auto', padding: '2rem 1rem', flex: 1, position: 'relative', zIndex: 10 }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Server style={{ width: 22, height: 22, color: '#818cf8' }} />
              </div>
              <div>
                <h1 style={{ fontSize: 26, fontWeight: 900, color: '#f1f5f9', margin: 0 }}>
                  مركز التحكم في قاعدة البيانات وعمليات الرفع (CRUD Dashboard)
                </h1>
                <p style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 0' }}>
                  تحكم كامل ومباشر من واجهة البرنامج: مسح الجداول القديمة، مزامنة الأرقام التأمينية، تنظيف المكررات، وحذف الملفات
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            {/* Tabs Selector */}
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 3, border: '1px solid rgba(255,255,255,0.1)' }}>
              <button
                onClick={() => setActiveTab('tables')}
                style={{
                  padding: '8px 18px',
                  borderRadius: 9,
                  border: 'none',
                  background: activeTab === 'tables' ? '#6366f1' : 'transparent',
                  color: activeTab === 'tables' ? '#ffffff' : '#94a3b8',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                إدارة الجداول والبيانات (CRUD)
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                style={{
                  padding: '8px 18px',
                  borderRadius: 9,
                  border: 'none',
                  background: activeTab === 'logs' ? '#6366f1' : 'transparent',
                  color: activeTab === 'logs' ? '#ffffff' : '#94a3b8',
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                سجل الملفات والدفعات المرفوعة ({logs.length})
              </button>
            </div>

            <button
              onClick={() => loadData(true)}
              disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#e2e8f0', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
            >
              <RefreshCw style={{ width: 14, height: 14 }} className={loading ? 'spin' : ''} />
              تحديث البيانات
            </button>
          </div>
        </div>

        {/* ── TAB 1: TABLES MANAGEMENT & CRUD ── */}
        {activeTab === 'tables' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>

              {/* CARD 1: وارد التأمينات */}
              <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 20, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#818cf8' }}>
                        <Database style={{ width: 20, height: 20 }} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', margin: 0 }}>جدول أرقام وارد التأمين</h3>
                        <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>incoming_insurance_records</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 24, fontWeight: 900, color: '#818cf8', fontFamily: 'monospace' }}>
                      {stats ? stats.incoming_insurance.total.toLocaleString('ar-EG') : '...'}
                    </span>
                  </div>

                  <div style={{ background: 'rgba(15,23,42,0.6)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>سجلات بأرقام تأمينية صالحة:</span>
                      <strong style={{ color: '#34d399', fontFamily: 'monospace' }}>
                        {stats ? stats.incoming_insurance.valid_insurance_number.toLocaleString('ar-EG') : '—'}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>سجلات بدون أرقام تأمينية:</span>
                      <strong style={{ color: '#fb7185', fontFamily: 'monospace' }}>
                        {stats ? stats.incoming_insurance.null_insurance_number.toLocaleString('ar-EG') : '—'}
                      </strong>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    disabled={actionLoading === 'sync_incoming'}
                    onClick={handleSyncIncoming}
                    style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.4)', color: '#c7d2fe', fontWeight: 800, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <ArrowRightLeft style={{ width: 16, height: 16 }} />
                    مزامنة الأرقام التأمينية مع Master الآن
                  </button>

                  <button
                    onClick={() => setConfirmClear({ table: 'incoming_insurance', label: 'أرقام وارد التأمين', count: stats?.incoming_insurance.total || 0 })}
                    style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <Trash2 style={{ width: 15, height: 15 }} />
                    مسح كافة سجلات وارد التأمين بالكامل
                  </button>
                </div>
              </div>

              {/* CARD 2: سجل الاستقالات RES */}
              <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(244,63,94,0.25)', borderRadius: 20, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(244,63,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fb7185' }}>
                        <ShieldAlert style={{ width: 20, height: 20 }} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', margin: 0 }}>جدول ملف الاستقالات (RES.)</h3>
                        <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>resignation_records</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 24, fontWeight: 900, color: '#fb7185', fontFamily: 'monospace' }}>
                      {stats ? stats.resignation.total.toLocaleString('ar-EG') : '...'}
                    </span>
                  </div>

                  <div style={{ background: 'rgba(15,23,42,0.6)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>استقالات مسجل بها تاريخ فعلي:</span>
                      <strong style={{ color: '#fbbf24', fontFamily: 'monospace' }}>
                        {stats ? stats.resignation.with_date.toLocaleString('ar-EG') : '—'}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>موظفون مسجلون كمستقيلين في Master:</span>
                      <strong style={{ color: '#f43f5e', fontFamily: 'monospace' }}>
                        {stats ? stats.employees_master.resigned_count.toLocaleString('ar-EG') : '—'}
                      </strong>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    disabled={actionLoading === 'sync_resignation'}
                    onClick={handleSyncResignations}
                    style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(245,158,11,0.4)', color: '#fde68a', fontWeight: 800, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <ArrowRightLeft style={{ width: 16, height: 16 }} />
                    مزامنة وتحديث حالة المستقيلين في Master
                  </button>

                  <button
                    onClick={() => setConfirmClear({ table: 'resignation', label: 'سجل الاستقالات (RES.)', count: stats?.resignation.total || 0 })}
                    style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <Trash2 style={{ width: 15, height: 15 }} />
                    مسح كافة سجلات الاستقالات بالكامل
                  </button>
                </div>
              </div>

              {/* CARD 3: شيتات غاز مصر المجمعة */}
              <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: 20, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(56,189,248,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38bdf8' }}>
                        <Layers style={{ width: 20, height: 20 }} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', margin: 0 }}>شيتات غاز مصر (الـ 13 ورقة)</h3>
                        <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>sheet_data</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 24, fontWeight: 900, color: '#38bdf8', fontFamily: 'monospace' }}>
                      {stats ? stats.sheet_data.total.toLocaleString('ar-EG') : '...'}
                    </span>
                  </div>

                  <div style={{ background: 'rgba(15,23,42,0.6)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>الصفوف النشطة المفعلة (أحدث رفع):</span>
                      <strong style={{ color: '#38bdf8', fontFamily: 'monospace' }}>
                        {stats ? stats.sheet_data.active_latest.toLocaleString('ar-EG') : '—'}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>الصفوف المكررة السابقة (غير نشطة):</span>
                      <strong style={{ color: stats && stats.sheet_data.duplicates_inactive > 0 ? '#fb7185' : '#34d399', fontFamily: 'monospace' }}>
                        {stats ? stats.sheet_data.duplicates_inactive.toLocaleString('ar-EG') : '—'}
                      </strong>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    disabled={actionLoading === 'dedup_sheets'}
                    onClick={handleDeduplicateSheets}
                    style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: 'rgba(56,189,248,0.15)', border: '1px solid rgba(56,189,248,0.35)', color: '#bae6fd', fontWeight: 800, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <CheckCircle2 style={{ width: 16, height: 16 }} />
                    تنظيف المكررات (إبقاء أحدث صف فقط مفعل)
                  </button>

                  <button
                    onClick={() => setConfirmClear({ table: 'sheet_data', label: 'صفوف شيت غاز مصر المجمعة (sheet_data)', count: stats?.sheet_data.total || 0 })}
                    style={{ width: '100%', padding: '10px 16px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <Trash2 style={{ width: 15, height: 15 }} />
                    مسح شيتات غاز مصر بالكامل لإعادة الرفع النظيف
                  </button>
                </div>
              </div>

              {/* CARD 4: سجل الموظفين Master */}
              <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 20, padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(52,211,153,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#34d399' }}>
                        <ShieldCheck style={{ width: 20, height: 20 }} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', margin: 0 }}>الدليل الموحد الشامل Master</h3>
                        <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>employees_master</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 24, fontWeight: 900, color: '#34d399', fontFamily: 'monospace' }}>
                      {stats ? stats.employees_master.total.toLocaleString('ar-EG') : '...'}
                    </span>
                  </div>

                  <div style={{ background: 'rgba(15,23,42,0.6)', borderRadius: 12, padding: '12px 16px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>موظفون برقم تأميني مكتمل:</span>
                      <strong style={{ color: '#34d399', fontFamily: 'monospace' }}>
                        {stats ? stats.employees_master.with_insurance_number.toLocaleString('ar-EG') : '—'}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#94a3b8' }}>موظفون بدون رقم تأميني:</span>
                      <strong style={{ color: stats && stats.employees_master.null_insurance_number > 0 ? '#fb7185' : '#34d399', fontFamily: 'monospace' }}>
                        {stats ? stats.employees_master.null_insurance_number.toLocaleString('ar-EG') : '—'}
                      </strong>
                    </div>
                  </div>
                </div>

                <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)', color: '#94a3b8', fontSize: 12, textAlign: 'center' }}>
                  هذا الجدول هو المرجع النهائي الذي تُبنى عليه كافة تقارير HR Letter والمطابقة واستدعاء الموظف 360°.
                </div>
              </div>

            </div>
          </div>
        )}

        {/* ── TAB 2: IMPORT BATCHES LOGS & CRUD ── */}
        {activeTab === 'logs' && (
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 20, overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <History style={{ width: 18, height: 18, color: '#818cf8' }} />
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#ffffff', margin: 0 }}>سجل دفعات الاستيراد</h3>
              </div>
              <span style={{ fontSize: 12, color: '#64748b' }}>إجمالي {logs.length} عملية استيراد</span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.02)', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '14px 20px' }}>اسم الملف</th>
                    <th style={{ padding: '14px 20px' }}>نوع المصدر</th>
                    <th style={{ padding: '14px 20px' }}>تاريخ الرفع</th>
                    <th style={{ padding: '14px 20px' }}>السجلات المقبولة</th>
                    <th style={{ padding: '14px 20px' }}>ملاحظات</th>
                    <th style={{ padding: '14px 20px', textAlign: 'center' }}>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.2s' }}>
                      <td style={{ padding: '16px 20px', fontWeight: 800, color: '#f1f5f9' }}>
                        {log.file_name}
                      </td>
                      <td style={{ padding: '16px 20px' }}>
                        <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 6, background: 'rgba(99,102,241,0.15)', color: '#a5b4fc' }}>
                          {SOURCE_CFG[log.source_type]?.label || log.source_type}
                        </span>
                      </td>
                      <td style={{ padding: '16px 20px', color: '#94a3b8', fontSize: 12 }}>
                        {new Date(log.created_at).toLocaleString('ar-EG')}
                      </td>
                      <td style={{ padding: '16px 20px', fontFamily: 'monospace', fontWeight: 800, color: '#34d399' }}>
                        {(log.rows_accepted || 0).toLocaleString('ar-EG')}
                      </td>
                      <td style={{ padding: '16px 20px', color: '#64748b', fontSize: 12, maxWidth: 300 }}>
                        {log.notes || '—'}
                      </td>
                      <td style={{ padding: '16px 20px', textAlign: 'center' }}>
                        <button
                          disabled={actionLoading === `delete_${log.id}`}
                          onClick={() => setConfirmDeleteLog({ id: log.id, fileName: log.file_name })}
                          style={{ padding: '7px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <Trash2 style={{ width: 14, height: 14 }} />
                          حذف الدفعة
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>

      {/* ── MODAL: Confirm Clear Table ── */}
      {confirmClear && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#0f172a', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 20, padding: 28, maxWidth: 480, width: '100%', textAlign: 'right' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fb7185', marginBottom: 16 }}>
              <AlertTriangle style={{ width: 26, height: 26 }} />
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 900, color: '#ffffff', margin: '0 0 8px' }}>
              تأكيد مسح {confirmClear.label}
            </h3>
            <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, margin: '0 0 20px' }}>
              أنت على وشك مسح <strong>{confirmClear.count.toLocaleString('ar-EG')} سجل</strong> من {confirmClear.label}.
              هذه العملية نهائية ولا يمكن التراجع عنها. هل أنت متأكد تماماً من رغبتك في المتابعة؟
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setConfirmClear(null)}
                style={{ padding: '10px 18px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#cbd5e1', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                إلغاء
              </button>
              <button
                onClick={handleClearTable}
                style={{ padding: '10px 22px', borderRadius: 10, background: '#ef4444', border: 'none', color: '#ffffff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
              >
                تأكيد المسح النهائي
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: Confirm Delete Single Import Batch ── */}
      {confirmDeleteLog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ background: '#0f172a', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 20, padding: 28, maxWidth: 480, width: '100%', textAlign: 'right' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fb7185', marginBottom: 16 }}>
              <Trash2 style={{ width: 26, height: 26 }} />
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 900, color: '#ffffff', margin: '0 0 8px' }}>
              حذف ملف "{confirmDeleteLog.fileName}"
            </h3>
            <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, margin: '0 0 20px' }}>
              سيتم حذف سجل العملية وكافة السجلات المرتبطة بها في الجداول التابعة. هل تريد المتابعة؟
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setConfirmDeleteLog(null)}
                style={{ padding: '10px 18px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#cbd5e1', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                إلغاء
              </button>
              <button
                onClick={handleDeleteImport}
                style={{ padding: '10px 22px', borderRadius: 10, background: '#ef4444', border: 'none', color: '#ffffff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
              >
                تأكيد حذف الملف
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
