'use client';

import { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import {
  History, Trash2, FileSpreadsheet, RefreshCw, Sparkles,
  CheckCircle2, XCircle, Database, ShieldCheck, TrendingUp,
  AlertCircle, Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import CountUp from 'react-countup';

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

const SOURCE_CFG: Record<string, { label: string; cls: string }> = {
  incoming_insurance: { label: 'أرقام وارد التأمين',    cls: 'badge-brand'   },
  res:                { label: 'ملف RES (الاستقالات)',  cls: 'badge-rose'    },
  monthly_payroll:    { label: 'مرتبات شهرية',          cls: 'badge-violet'  },
  monthly_insurance:  { label: 'تأمينات شهرية',         cls: 'badge-emerald' },
};

type IconComp = React.ElementType;

function StatCard({
  icon: Icon, label, value, color, radialColor, delay = 0,
}: { icon: IconComp; label: string; value: number; color: string; radialColor: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card glass-card-hover"
      style={{ borderRadius: 20, padding: '1.5rem', position: 'relative', overflow: 'hidden' }}
    >
      {/* Radial glow bottom-right */}
      <div style={{
        position: 'absolute', bottom: -30, right: -30,
        width: 130, height: 130, borderRadius: '50%',
        background: `radial-gradient(circle, ${radialColor} 0%, transparent 70%)`,
        pointerEvents: 'none',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, position: 'relative', zIndex: 1 }}>
        <div style={{
          width: 52, height: 52, borderRadius: 16, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${color}18`, border: `1px solid ${color}30`,
        }}>
          <Icon style={{ width: 24, height: 24, color }} />
        </div>
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>{label}</p>
          <p className="font-mono-pro" style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1 }}>
            <CountUp end={value} duration={1.6} separator="," />
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export default function HistoryPage() {
  const [logs, setLogs]           = useState<ImportLog[]>([]);
  const [loading, setLoading]     = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchLogs = async (showToast = false) => {
    setLoading(true);
    try {
      const res  = await fetch('/api/import/history');
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs || []);
        if (showToast) toast.success('تم تحديث السجل بنجاح');
      }
    } catch { toast.error('خطأ أثناء تحميل السجل'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchLogs(); }, []);

  const [confirmModal, setConfirmModal] = useState<{ id: string; name: string; sourceType: string; month: string } | null>(null);

  const handleDeleteClick = (log: ImportLog) => {
    const monthLabel = log.period_month && log.period_year
      ? `شهر ${log.period_month}/${log.period_year}`
      : '';
    setConfirmModal({
      id: log.id,
      name: log.file_name,
      sourceType: SOURCE_CFG[log.source_type]?.label ?? log.source_type,
      month: monthLabel,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!confirmModal) return;
    const { id, name } = confirmModal;
    setConfirmModal(null);
    setDeletingId(id);
    const tid = toast.loading(`جارٍ حذف "${name}"...`);
    try {
      const res  = await fetch(`/api/import/history?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || 'تم الحذف بنجاح', { id: tid });
        setLogs((p) => p.filter((l) => l.id !== id));
      } else {
        toast.error(data.error || 'فشل الحذف', { id: tid });
      }
    } catch { toast.error('خطأ أثناء الحذف', { id: tid }); }
    finally { setDeletingId(null); }
  };

  const totalImports      = logs.length;
  const totalAccepted     = logs.reduce((a, c) => a + (c.rows_accepted  || 0), 0);
  const totalRejected     = logs.reduce((a, c) => a + (c.rows_rejected || 0), 0);
  const acceptRate        = totalImports > 0
    ? Math.round((totalAccepted / Math.max(totalAccepted + totalRejected, 1)) * 100)
    : 0;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#080d1a', position: 'relative' }}>

      {/* Ambient orbs */}
      <div className="orb orb-tl" style={{ opacity: 0.15 }} />
      <div className="orb orb-bl" style={{ opacity: 0.1  }} />

      <Navbar />

      <main style={{ width: '94%', maxWidth: 1800, margin: '0 auto', padding: '2rem 1rem', flex: 1, position: 'relative', zIndex: 10 }}>

        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y:   0 }}
          transition={{ duration: 0.4 }}
          className="page-header-row"
        >
          <div>
            <span className="badge-brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, padding: '4px 14px', borderRadius: 9999, marginBottom: 10 }}>
              <Sparkles style={{ width: 12, height: 12 }} />
              لوحة مراقبة عمليات الاستيراد
            </span>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: '#f1f5f9', letterSpacing: '-0.3px', margin: '0 0 6px' }}>
              سجل عمليات الاستيراد
            </h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
              سجل تاريخي لكافة ملفات Excel المرفوعة مع إمكانية الحذف
            </p>
          </div>

          <button
            onClick={() => fetchLogs(true)}
            disabled={loading}
            className="btn-ghost"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            <RefreshCw style={{ width: 15, height: 15, color: loading ? '#818cf8' : undefined, animation: loading ? 'spin-dual 1s linear infinite' : undefined }} />
            تحديث السجل
          </button>
        </motion.div>

        {/* ── KPI Stats ── */}
        <div className="stats-grid" style={{ marginBottom: 24 }}>
          <StatCard icon={Database}     label="إجمالي عمليات الرفع"     value={totalImports}  color="#818cf8" radialColor="rgba(99,102,241,0.2)"  delay={0}   />
          <StatCard icon={CheckCircle2} label="السجلات المقبولة"         value={totalAccepted} color="#34d399" radialColor="rgba(16,185,129,0.2)"  delay={0.1} />
          <StatCard icon={XCircle}      label="السجلات المرفوضة"         value={totalRejected} color="#fb7185" radialColor="rgba(244,63,94,0.2)"   delay={0.2} />
          <StatCard icon={TrendingUp}   label="نسبة القبول الكلية (%)"   value={acceptRate}    color="#fbbf24" radialColor="rgba(245,158,11,0.2)"  delay={0.3} />
        </div>

        {/* ── Progress Bar ── */}
        {totalImports > 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
            className="glass-card"
            style={{ borderRadius: 18, padding: '1.25rem 1.5rem', marginBottom: 24 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck style={{ width: 16, height: 16, color: '#818cf8' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>نسبة القبول الإجمالية</span>
              </div>
              <span className="font-mono-pro" style={{ fontSize: 18, fontWeight: 800, color: acceptRate >= 80 ? '#34d399' : acceptRate >= 50 ? '#fbbf24' : '#fb7185' }}>
                {acceptRate}%
              </span>
            </div>
            <div className="progress-bar">
              <motion.div
                className="progress-fill"
                initial={{ width: 0 }}
                animate={{ width: `${acceptRate}%` }}
                transition={{ delay: 0.7, duration: 1.2, ease: 'easeOut' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#475569' }}>
              <span>مقبول: <strong style={{ color: '#34d399' }}>{totalAccepted.toLocaleString('ar-EG')}</strong></span>
              <span>مرفوض: <strong style={{ color: '#fb7185' }}>{totalRejected.toLocaleString('ar-EG')}</strong></span>
            </div>
          </motion.div>
        )}

        {/* ── Table Card ── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}
          className="glass-card"
          style={{ borderRadius: 24, overflow: 'hidden' }}
        >
          {/* Table Header Bar */}
          <div style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(148,163,184,0.08)', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)' }}>
              <History style={{ width: 17, height: 17, color: '#818cf8' }} />
            </div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>جدول الاستيرادات</p>
              <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>{logs.length} عملية مسجلة</p>
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div style={{ padding: '5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{ position: 'relative', width: 48, height: 48 }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(99,102,241,0.2)', borderTop: '2px solid #6366f1', animation: 'spin-dual 0.8s linear infinite' }} />
                <div style={{ position: 'absolute', inset: 8, borderRadius: '50%', border: '2px solid rgba(139,92,246,0.2)', borderBottom: '2px solid #8b5cf6', animation: 'spin-dual 0.6s linear infinite reverse' }} />
              </div>
              <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>جارٍ تحميل السجل...</span>
            </div>
          )}

          {/* Empty */}
          {!loading && logs.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: '5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <div style={{ width: 72, height: 72, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.15)', marginBottom: 16 }}>
                <FileSpreadsheet style={{ width: 36, height: 36, color: '#4f5b7a' }} />
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', margin: '0 0 8px' }}>لا توجد عمليات مسجلة</h3>
              <p style={{ fontSize: 13, color: '#475569', maxWidth: 360 }}>توجه لصفحة الاستيراد لرفع أول ملف Excel.</p>
            </motion.div>
          )}

          {/* Table */}
          {!loading && logs.length > 0 && (
            <div className="table-scroll">
              <table className="table-dark">
                <thead>
                  <tr>
                    <th>نوع المصدر</th>
                    <th>اسم الملف</th>
                    <th>الفترة</th>
                    <th>الصفحة</th>
                    <th>إجمالي</th>
                    <th style={{ color: '#34d399' }}>مقبولة</th>
                    <th style={{ color: '#fb7185' }}>مرفوضة</th>
                    <th>تاريخ الرفع</th>
                    <th style={{ textAlign: 'center' }}>حذف</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {logs.map((log, idx) => {
                      const src = SOURCE_CFG[log.source_type];
                      const rejectPct = log.total_rows_read > 0 ? Math.round((log.rows_rejected / log.total_rows_read) * 100) : 0;
                      return (
                        <motion.tr
                          key={log.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          transition={{ delay: idx * 0.04 }}
                        >
                          <td>
                            <span className={`${src?.cls ?? 'badge-slate'} font-mono-pro`} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 8, fontWeight: 700, whiteSpace: 'nowrap' }}>
                              {src?.label ?? log.source_type}
                            </span>
                          </td>
                          <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: '#f1f5f9' }} title={log.file_name}>
                            {log.file_name}
                          </td>
                          <td className="font-mono-pro" style={{ fontWeight: 700, color: '#fff' }}>
                            {log.period_month && log.period_year ? `${log.period_month}/${log.period_year}` : <span style={{ color: '#334155' }}>—</span>}
                          </td>
                          <td style={{ color: '#94a3b8' }}>{log.sheet_name || 'الأولى'}</td>
                          <td className="font-mono-pro" style={{ fontWeight: 700, color: '#94a3b8' }}>{log.total_rows_read.toLocaleString()}</td>
                          <td className="font-mono-pro" style={{ fontWeight: 800, color: '#34d399' }}>{log.rows_accepted.toLocaleString()}</td>
                          <td>
                            <span className="font-mono-pro" style={{ fontWeight: 800, color: '#fb7185' }}>{log.rows_rejected.toLocaleString()}</span>
                            {rejectPct > 0 && (
                              <span className="badge-rose font-mono-pro" style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, marginRight: 6, fontWeight: 700 }}>{rejectPct}%</span>
                            )}
                          </td>
                          <td className="font-mono-pro" style={{ color: '#475569', fontSize: 12, whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Calendar style={{ width: 12, height: 12 }} />
                              {new Date(log.created_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
                            </div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleDeleteClick(log)}
                              disabled={deletingId === log.id}
                              className="btn-danger"
                              style={{ padding: '7px', borderRadius: 10, cursor: deletingId === log.id ? 'not-allowed' : 'pointer', display: 'inline-flex' }}
                              title="حذف هذه العملية"
                            >
                              {deletingId === log.id
                                ? <span style={{ width: 15, height: 15, borderRadius: '50%', border: '2px solid rgba(251,113,133,0.3)', borderTop: '2px solid #fb7185', display: 'inline-block', animation: 'spin-dual 0.7s linear infinite' }} />
                                : <Trash2 style={{ width: 15, height: 15 }} />}
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </motion.div>

        {/* Warning footer */}
        {!loading && logs.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, color: '#475569' }}
          >
            <AlertCircle style={{ width: 13, height: 13, flexShrink: 0 }} />
            <p style={{ fontSize: 11, margin: 0 }}>تحذير: حذف عملية استيراد يزيل كافة سجلاتها نهائياً.</p>
          </motion.div>
        )}

      </main>
    </div>
  );
}
