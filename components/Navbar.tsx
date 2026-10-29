'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, UploadCloud, History, ShieldCheck, Sparkles, Menu, X, FileSpreadsheet } from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const NAV_ITEMS = [
  { href: '/lookup',  label: 'استدعاء موظف',  icon: Search,          badge: 'رئيسي', color: '#818cf8' },
  { href: '/reports', label: 'التقارير والقوالب', icon: FileSpreadsheet, badge: '2026', color: '#38bdf8' },
  { href: '/import',  label: 'استيراد ملفات', icon: UploadCloud,     badge: 'Excel',  color: '#34d399' },
  { href: '/history', label: 'سجل العمليات',  icon: History,                          color: '#a78bfa' },
];

export default function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);


  return (
    <header className="glass-panel" style={{ position: 'sticky', top: 0, zIndex: 40 }}>
      <div className="gradient-top-bar" />

      <div style={{ width: '94%', maxWidth: 1800, margin: '0 auto', padding: '0 1rem' }}>

        {/* ── Main Row ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>

          {/* Logo */}
          <Link href="/lookup" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }}>
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: 12, background: 'rgba(99,102,241,0.4)', filter: 'blur(10px)', opacity: 0.7 }} />
              <div style={{
                position: 'relative', width: 38, height: 38, borderRadius: 12,
                background: 'linear-gradient(135deg, #4338ca, #6366f1, #7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 6px 24px rgba(99,102,241,0.4)',
              }}>
                <ShieldCheck style={{ width: 20, height: 20, color: '#fff' }} />
              </div>
              <span style={{ position: 'absolute', bottom: -2, right: -2, width: 10, height: 10, borderRadius: '50%', background: '#10b981', border: '2px solid #080d1a', display: 'block' }}>
                <span style={{ position: 'absolute', inset: -2, borderRadius: '50%', background: 'rgba(16,185,129,0.5)', animation: 'ping-ring 2s cubic-bezier(0,0,0.2,1) infinite' }} />
              </span>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: '#f1f5f9' }}>Employee Lookup</span>
                <span className="badge-brand hide-mobile" style={{ fontSize: 10, padding: '1px 7px', borderRadius: 9999, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Sparkles style={{ width: 9, height: 9 }} /> PRO
                </span>
              </div>
              <span className="hide-mobile" style={{ fontSize: 10, color: '#475569', display: 'block' }}>منظومة استدعاء وتدقيق الموظفين</span>
            </div>
          </Link>

          {/* Desktop Nav */}
          <nav className="nav-desktop" style={{ alignItems: 'center', gap: 4, padding: '4px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.08)' }}>
            {NAV_ITEMS.map((item) => {
              const Icon     = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={isActive ? 'nav-active' : ''}
                  style={{
                    position: 'relative', display: 'flex', alignItems: 'center', gap: 6,
                    padding: '7px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
                    textDecoration: 'none',
                    color: isActive ? item.color : '#64748b',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = '#f1f5f9'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; } }}
                  onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = '#64748b'; e.currentTarget.style.background = 'transparent'; } }}
                >
                  <Icon style={{ width: 14, height: 14, color: isActive ? item.color : 'inherit' }} />
                  {item.label}
                  {item.badge && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 6, fontWeight: 700, background: isActive ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.05)', color: isActive ? item.color : '#475569' }}>
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Right actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Hamburger (mobile) */}
            <button
              className="show-mobile"
              onClick={() => setMobileOpen(!mobileOpen)}
              style={{ alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.1)', cursor: 'pointer', color: '#94a3b8' }}
            >
              {mobileOpen ? <X style={{ width: 18, height: 18 }} /> : <Menu style={{ width: 18, height: 18 }} />}
            </button>
          </div>
        </div>

        {/* ── Mobile Nav Drawer ── */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              style={{ overflow: 'hidden', borderTop: '1px solid rgba(148,163,184,0.08)' }}
            >
              <div style={{ padding: '10px 0 14px' }}>
                {NAV_ITEMS.map((item) => {
                  const Icon     = item.icon;
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={isActive ? 'nav-active' : ''}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 12, fontSize: 13, fontWeight: 700, textDecoration: 'none', marginBottom: 4, color: isActive ? item.color : '#94a3b8', transition: 'all 0.15s' }}
                    >
                      <Icon style={{ width: 17, height: 17 }} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </header>
  );
}
