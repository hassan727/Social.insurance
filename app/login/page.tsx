'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck, Lock, User, ArrowLeft,
  Sparkles, KeyRound, Eye, EyeOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [showPw, setShowPw]     = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'بيانات الدخول غير صحيحة');
      toast.success('تم تسجيل الدخول بنجاح!');
      router.push('/lookup');
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  };

  return (
    /* page-center = min-h-screen flex col center + relative overflow-hidden */
    <div className="page-center">

      {/* Ambient orbs — absolute inside page-center */}
      <div className="orb orb-tl" />
      <div className="orb orb-bl" />
      <div className="orb orb-mid" />

      {/* Grid dot overlay */}
      <div className="grid-overlay" />

      {/* ── Card wrapper with glow ring ── */}
      <motion.div
        initial={{ opacity: 0, y: 36, scale: 0.94 }}
        animate={{ opacity: 1, y: 0,  scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="login-card-wrap"
      >
        <div className="glass-card rounded-3xl">

          {/* Top gradient stripe */}
          <div className="gradient-top-bar" />

          <div style={{ padding: '2.5rem 2.5rem 2rem' }}>

            {/* ── Brand header ── */}
            <div style={{ textAlign: 'center', marginBottom: '2.25rem' }}>

              {/* Icon with glow */}
              <motion.div
                initial={{ scale: 0.5, rotate: -15, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.55, type: 'spring', stiffness: 180 }}
                style={{ position: 'relative', width: 80, height: 80, margin: '0 auto 1.25rem' }}
              >
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: 20,
                  background: 'rgba(99,102,241,0.5)', filter: 'blur(16px)',
                  animation: 'orb-pulse 3s ease-in-out infinite',
                }} />
                <div style={{
                  position: 'relative', width: 80, height: 80, borderRadius: 20,
                  background: 'linear-gradient(135deg, #4338ca 0%, #6366f1 55%, #7c3aed 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 12px 40px rgba(99,102,241,0.5), 0 0 0 1px rgba(255,255,255,0.1)',
                }}>
                  <ShieldCheck style={{ width: 42, height: 42, color: '#fff' }} />
                </div>
              </motion.div>

              {/* System badge */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12 }}
              >
                <span className="badge-brand" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 9999 }}>
                  <Sparkles style={{ width: 12, height: 12 }} />
                  Employee Insurance &amp; Payroll Lookup
                </span>
              </motion.div>

              <motion.h1
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                style={{ fontSize: 26, fontWeight: 900, color: '#fff', margin: '0 0 6px', letterSpacing: '-0.3px' }}
              >
                استدعاء وفحص الموظفين
              </motion.h1>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
                style={{ fontSize: 13, color: '#64748b', margin: 0 }}
              >
                تسجيل الدخول الآمن للمستخدم المصرح له
              </motion.p>
            </div>

            {/* Divider */}
            <div className="divider-glow" style={{ marginBottom: '1.75rem' }} />

            {/* ── Form ── */}
            <form onSubmit={handleSubmit}>

              {/* Username field */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.38 }}
                style={{ marginBottom: 16 }}
              >
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>
                  اسم المستخدم
                </label>
                <div className="search-glow" style={{ position: 'relative', borderRadius: 14 }}>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="أدخل اسم المستخدم"
                    className="input-dark"
                    style={{ paddingRight: 48, paddingLeft: 16, paddingTop: 14, paddingBottom: 14, borderRadius: 14, fontSize: 14 }}
                  />
                  <User style={{ width: 18, height: 18, color: '#475569', position: 'absolute', right: 15, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                </div>
              </motion.div>

              {/* Password field */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.44 }}
                style={{ marginBottom: 24 }}
              >
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>
                  كلمة المرور
                </label>
                <div className="search-glow" style={{ position: 'relative', borderRadius: 14 }}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••"
                    className="input-dark"
                    style={{ paddingRight: 48, paddingLeft: 48, paddingTop: 14, paddingBottom: 14, borderRadius: 14, fontSize: 14 }}
                  />
                  <Lock style={{ width: 18, height: 18, color: '#475569', position: 'absolute', right: 15, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex' }}
                  >
                    {showPw ? <EyeOff style={{ width: 17, height: 17 }} /> : <Eye style={{ width: 17, height: 17 }} />}
                  </button>
                </div>
              </motion.div>

              {/* Submit */}
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                type="submit"
                disabled={loading}
                className="btn-primary"
                style={{
                  width: '100%', padding: '15px 24px', borderRadius: 14,
                  fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                }}
              >
                {loading ? (
                  <>
                    <span style={{
                      width: 18, height: 18, borderRadius: '50%',
                      border: '2px solid rgba(255,255,255,0.25)',
                      borderTop: '2px solid #fff',
                      display: 'inline-block',
                      animation: 'spin-dual 0.7s linear infinite',
                    }} />
                    جارٍ التحقق المشفر...
                  </>
                ) : (
                  <>
                    تسجيل الدخول للنظام
                    <ArrowLeft style={{ width: 17, height: 17 }} />
                  </>
                )}
              </motion.button>
            </form>

            {/* ── Security footer ── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.65 }}
              style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(148,163,184,0.08)', textAlign: 'center' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}>
                <KeyRound style={{ width: 14, height: 14, color: '#6366f1' }} />
                <span style={{ fontSize: 11, color: '#475569' }}>محمي بتشفير JWT وفق معايير الأمان المؤسسي</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {['JWT', 'HTTPS', 'AES-256', 'TLS 1.3'].map((tag) => (
                  <span key={tag} className="badge-brand font-mono-pro" style={{ fontSize: 10, padding: '2px 8px', borderRadius: 6 }}>
                    {tag}
                  </span>
                ))}
              </div>
            </motion.div>

          </div>
        </div>

        {/* Card reflection */}
        <div style={{
          margin: '0 3rem',
          height: 12,
          borderRadius: '0 0 24px 24px',
          background: 'linear-gradient(to bottom, rgba(99,102,241,0.2), transparent)',
          opacity: 0.5,
        }} />
      </motion.div>

      {/* Version watermark */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.35 }}
        transition={{ delay: 1 }}
        className="font-mono-pro"
        style={{ position: 'absolute', bottom: 20, fontSize: 10, color: '#334155', zIndex: 10 }}
      >
        v2.0 PRO — Employee Lookup System © 2026
      </motion.p>

    </div>
  );
}
