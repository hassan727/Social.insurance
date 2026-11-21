'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Search, UploadCloud, History, ShieldCheck, Sparkles, 
  Menu, X, FileSpreadsheet, Users, ShieldAlert, GitMerge, Sliders,
  ChevronDown, FileUp, Database, Layers, ArrowLeft
} from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface NavSubItem {
  href: string;
  label: string;
  desc: string;
  icon: React.ElementType;
  badge?: string;
  badgeColor?: string;
}

interface NavGroup {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
  href?: string; // For single links without children
  items?: NavSubItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'employees',
    label: 'الموظفون',
    icon: Users,
    color: '#818cf8',
    items: [
      {
        href: '/employees',
        label: 'دليل الموظفين Master',
        desc: 'استعراض السجلات الشاملة، الفلترة حسب الشركة والحالة، والتصدير',
        icon: Users,
        badge: 'Master',
        badgeColor: '#818cf8',
      },
      {
        href: '/lookup',
        label: 'استدعاء وفحص 360°',
        desc: 'البحث الفوري وكارت الموظف الموحد وجدول المرتبات والتأمينات 1..12',
        icon: Search,
        badge: '360°',
        badgeColor: '#a78bfa',
      },
    ],
  },
  {
    id: 'reports',
    label: 'التقارير',
    icon: FileSpreadsheet,
    color: '#38bdf8',
    items: [
      {
        href: '/reports',
        label: 'التقارير المعتمدة 2026',
        desc: 'HR Letter، المطابقة الشاملة، الحد الأدنى 7000، الفاتورة، وTCOE',
        icon: FileSpreadsheet,
        badge: '2026',
        badgeColor: '#38bdf8',
      },
      {
        href: '/reports?tab=official_print_audit',
        label: '🔍 التدقيق الجنائي لبرنت التأمينات',
        desc: 'مطابقة برنت 22/09/2026 مع المرتبات، كشف التعارض الوظيفي، وتعديل المهن',
        icon: ShieldCheck,
        badge: 'جديد 22/9',
        badgeColor: '#f43f5e',
      },
      {
        href: '/report-builder',
        label: 'مصمم التقارير المخصصة',
        desc: 'بناء استعلام حر باختيار الأعمدة والفلاتر واستخراج شيتات مخصصة',
        icon: Sliders,
        badge: 'Builder',
        badgeColor: '#06b6d4',
      },
    ],
  },
  {
    id: 'audit',
    label: 'التدقيق والحوكمة',
    icon: ShieldAlert,
    color: '#f59e0b',
    items: [
      {
        href: '/data-quality',
        label: 'جودة ونقاء البيانات',
        desc: 'كشف الحقول التالفة، البطاقات القومية الشاذة، وتضارب التواريخ',
        icon: ShieldAlert,
        badge: 'Audit',
        badgeColor: '#f59e0b',
      },
      {
        href: '/matching-review',
        label: 'مطابقة السجلات العالقة',
        desc: 'مراجعة وحسم التعارضات والأسطر غير المتطابقة بالذكاء الاصطناعي',
        icon: GitMerge,
        badge: 'AI Review',
        badgeColor: '#ec4899',
      },
      {
        href: '/conflict-review',
        label: 'تعارضات البيانات بين الشيتات',
        desc: 'مقارنة حقل بحقل — قبول أو رفض أو دمج يدوي لكل تعارض بين الشيتات المختلفة',
        icon: ArrowLeft,
        badge: 'جديد',
        badgeColor: '#f59e0b',
      },
    ],
  },
  {
    id: 'ingestion',
    label: 'الاستيراد والرفع',
    icon: UploadCloud,
    color: '#34d399',
    items: [
      {
        href: '/smart-import',
        label: 'استيراد الشيت الشامل',
        desc: 'رفع شيت غاز مصر المجمع متعدد الأوراق مع التوزيع الذكي والمطابقة',
        icon: Sparkles,
        badge: 'Multi-Sheet',
        badgeColor: '#34d399',
      },
      {
        href: '/import',
        label: 'استيراد الملفات الدورية',
        desc: 'رفع شيتات المرتبات الشهرية، تأمينات شهر محدد، وارد التأمين، والاستقالات',
        icon: FileUp,
        badge: 'شهري/دوري',
        badgeColor: '#10b981',
      },
    ],
  },
  {
    id: 'history',
    label: 'سجل العمليات',
    icon: History,
    color: '#94a3b8',
    href: '/history',
  },
];

export default function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [mobileExpandedGroup, setMobileExpandedGroup] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Close menus on route change
  useEffect(() => {
    setMobileOpen(false);
    setActiveDropdown(null);
  }, [pathname]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  // Close on escape key and click outside
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        setActiveDropdown(null);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setActiveDropdown(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleMouseEnter = (groupId: string) => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setActiveDropdown(groupId);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setActiveDropdown(null);
    }, 180);
  };

  const toggleDropdown = (groupId: string) => {
    setActiveDropdown(prev => (prev === groupId ? null : groupId));
  };

  const toggleMobileGroup = (groupId: string) => {
    setMobileExpandedGroup(prev => (prev === groupId ? null : groupId));
  };

  // Helper to check if group is active
  const isGroupActive = useCallback((group: NavGroup) => {
    if (group.href) {
      return pathname === group.href;
    }
    return group.items?.some(sub => pathname === sub.href) ?? false;
  }, [pathname]);

  return (
    <>
      {/* ── Navbar Header ── */}
      <nav 
        className="glass-panel"
        style={{ 
          position: 'sticky',
          top: 0,
          zIndex: 'var(--z-sticky)',
          width: '100%'
        }}
      >
        {/* Gradient top bar */}
        <div className="gradient-top-bar" />

        {/* Container */}
        <div style={{ 
          width: '95%', 
          maxWidth: '1800px', 
          margin: '0 auto', 
          padding: '0 0.75rem' 
        }}>
          {/* Main Row */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            height: 'var(--navbar-height-mobile)',
            gap: '1rem'
          }}>
            
            {/* ── Logo ── */}
            <Link 
              href="/lookup" 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '10px',
                textDecoration: 'none',
                flexShrink: 0
              }}
            >
              {/* Logo Icon */}
              <div style={{ position: 'relative' }}>
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '12px',
                  background: 'rgba(99,102,241,0.4)',
                  filter: 'blur(10px)',
                  opacity: 0.7
                }} />
                <div style={{
                  position: 'relative',
                  width: '38px',
                  height: '38px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #4338ca, #6366f1, #7c3aed)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 6px 24px rgba(99,102,241,0.4)'
                }}>
                  <ShieldCheck style={{ width: 20, height: 20, color: '#fff' }} />
                </div>
                {/* Status pulse dot */}
                <span style={{
                  position: 'absolute',
                  bottom: '-2px',
                  right: '-2px',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: '#10b981',
                  border: '2px solid #080d1a',
                  display: 'block'
                }}>
                  <span style={{
                    position: 'absolute',
                    inset: '-2px',
                    borderRadius: '50%',
                    background: 'rgba(16,185,129,0.5)',
                    animation: 'ping-ring 2s cubic-bezier(0,0,0.2,1) infinite'
                  }} />
                </span>
              </div>

              {/* Logo Text */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ 
                    fontSize: '15px', 
                    fontWeight: 800, 
                    color: '#f1f5f9',
                    letterSpacing: '-0.02em'
                  }}>
                    Employee Lookup
                  </span>
                  <span 
                    className="hide-mobile badge-brand" 
                    style={{ 
                      fontSize: '10px',
                      padding: '1px 7px',
                      borderRadius: '9999px',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px'
                    }}
                  >
                    <Sparkles style={{ width: 9, height: 9 }} /> PRO
                  </span>
                </div>
                <span 
                  className="hide-mobile" 
                  style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, display: 'block' }}
                >
                  منظومة استدعاء وتدقيق الموظفين الموحدة
                </span>
              </div>
            </Link>

            {/* ── Desktop Navigation ── */}
            <nav 
              ref={dropdownRef}
              className="nav-desktop"
              style={{ 
                alignItems: 'center',
                gap: '6px',
                padding: '5px 8px',
                borderRadius: '16px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(148,163,184,0.1)',
                position: 'relative'
              }}
            >
              {NAV_GROUPS.map((group) => {
                const Icon = group.icon;
                const active = isGroupActive(group);
                const isDropdownOpen = activeDropdown === group.id;

                // Single link (e.g. History)
                if (group.href) {
                  return (
                    <Link
                      key={group.id}
                      href={group.href}
                      className={active ? 'nav-active' : ''}
                      style={{
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '7px',
                        padding: '8px 14px',
                        borderRadius: '12px',
                        fontSize: '13px',
                        fontWeight: 700,
                        textDecoration: 'none',
                        color: active ? group.color : '#94a3b8',
                        background: active ? `${group.color}15` : 'transparent',
                        border: active ? `1px solid ${group.color}35` : '1px solid transparent',
                        transition: 'all 0.2s ease',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      <Icon style={{ 
                        width: 15, 
                        height: 15, 
                        color: active ? group.color : 'inherit' 
                      }} />
                      {group.label}
                    </Link>
                  );
                }

                // Group with Sub-items (Dropdown)
                return (
                  <div
                    key={group.id}
                    style={{ position: 'relative' }}
                    onMouseEnter={() => handleMouseEnter(group.id)}
                    onMouseLeave={handleMouseLeave}
                  >
                    <button
                      onClick={() => toggleDropdown(group.id)}
                      className={active ? 'nav-active' : ''}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 14px',
                        borderRadius: '12px',
                        fontSize: '13px',
                        fontWeight: 700,
                        color: active ? group.color : '#94a3b8',
                        background: active 
                          ? `${group.color}15` 
                          : isDropdownOpen ? 'rgba(255,255,255,0.06)' : 'transparent',
                        border: active 
                          ? `1px solid ${group.color}35` 
                          : isDropdownOpen ? '1px solid rgba(148,163,184,0.18)' : '1px solid transparent',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      <Icon style={{ 
                        width: 15, 
                        height: 15, 
                        color: active ? group.color : 'inherit' 
                      }} />
                      <span>{group.label}</span>
                      <ChevronDown 
                        style={{ 
                          width: 13, 
                          height: 13, 
                          transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s ease',
                          opacity: 0.7
                        }} 
                      />
                    </button>

                    {/* Desktop Floating Glass Dropdown */}
                    <AnimatePresence>
                      {isDropdownOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: 8, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 6, scale: 0.97 }}
                          transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                          style={{
                            position: 'absolute',
                            top: 'calc(100% + 8px)',
                            right: 0,
                            minWidth: '320px',
                            background: 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(8,13,26,0.99) 100%)',
                            backdropFilter: 'blur(24px)',
                            border: '1px solid rgba(148,163,184,0.18)',
                            borderRadius: '18px',
                            boxShadow: '0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)',
                            padding: '10px',
                            zIndex: 100,
                            overflow: 'hidden'
                          }}
                        >
                          <div style={{
                            padding: '6px 10px 8px',
                            fontSize: '11px',
                            fontWeight: 800,
                            color: group.color,
                            letterSpacing: '0.04em',
                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                            marginBottom: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between'
                          }}>
                            <span>{group.label}</span>
                            <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>مركز العمليات</span>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {group.items?.map((sub) => {
                              const SubIcon = sub.icon;
                              const isSubActive = pathname === sub.href;
                              return (
                                <Link
                                  key={sub.href}
                                  href={sub.href}
                                  onClick={() => setActiveDropdown(null)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '12px',
                                    padding: '10px 12px',
                                    borderRadius: '12px',
                                    textDecoration: 'none',
                                    background: isSubActive ? `${group.color}18` : 'transparent',
                                    border: isSubActive ? `1px solid ${group.color}35` : '1px solid transparent',
                                    transition: 'all 0.15s ease'
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isSubActive) {
                                      e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                                      e.currentTarget.style.borderColor = 'rgba(148,163,184,0.12)';
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isSubActive) {
                                      e.currentTarget.style.background = 'transparent';
                                      e.currentTarget.style.borderColor = 'transparent';
                                    }
                                  }}
                                >
                                  <div style={{
                                    width: '34px',
                                    height: '34px',
                                    borderRadius: '10px',
                                    background: isSubActive ? `${group.color}25` : 'rgba(255,255,255,0.05)',
                                    border: `1px solid ${isSubActive ? `${group.color}40` : 'rgba(255,255,255,0.08)'}`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                    marginTop: '2px'
                                  }}>
                                    <SubIcon style={{ 
                                      width: 16, 
                                      height: 16, 
                                      color: isSubActive ? group.color : '#94a3b8' 
                                    }} />
                                  </div>

                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                      <span style={{ 
                                        fontSize: '13px', 
                                        fontWeight: 700, 
                                        color: isSubActive ? '#fff' : '#f1f5f9' 
                                      }}>
                                        {sub.label}
                                      </span>
                                      {sub.badge && (
                                        <span style={{
                                          fontSize: '9px',
                                          fontWeight: 800,
                                          padding: '2px 7px',
                                          borderRadius: '6px',
                                          background: `${sub.badgeColor || group.color}20`,
                                          color: sub.badgeColor || group.color,
                                          border: `1px solid ${sub.badgeColor || group.color}40`
                                        }}>
                                          {sub.badge}
                                        </span>
                                      )}
                                    </div>
                                    <p style={{ 
                                      fontSize: '11px', 
                                      color: '#64748b', 
                                      margin: '3px 0 0', 
                                      lineHeight: 1.4,
                                      whiteSpace: 'normal'
                                    }}>
                                      {sub.desc}
                                    </p>
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </nav>

            {/* ── Mobile Menu Toggle ── */}
            <button
              className="show-mobile-flex"
              onClick={() => setMobileOpen(prev => !prev)}
              aria-label={mobileOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
              aria-expanded={mobileOpen}
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                background: mobileOpen ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(148,163,184,0.1)',
                cursor: 'pointer',
                color: mobileOpen ? '#818cf8' : '#94a3b8',
                transition: 'all 0.2s ease',
                flexShrink: 0
              }}
            >
              {mobileOpen ? (
                <X style={{ width: 20, height: 20 }} />
              ) : (
                <Menu style={{ width: 20, height: 20 }} />
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* ── Mobile Menu Overlay ── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setMobileOpen(false)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.65)',
                backdropFilter: 'blur(4px)',
                zIndex: 'var(--z-modal-backdrop)',
                top: 'var(--navbar-height-mobile)'
              }}
            />

            {/* Mobile Menu Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
              style={{
                position: 'fixed',
                top: 'var(--navbar-height-mobile)',
                right: 0,
                bottom: 0,
                width: 'min(340px, 88vw)',
                maxWidth: '100%',
                background: 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(8,13,26,0.99) 100%)',
                borderLeft: '1px solid rgba(99,102,241,0.2)',
                boxShadow: '-8px 0 40px rgba(0,0,0,0.6)',
                zIndex: 'var(--z-modal)',
                overflowY: 'auto',
                padding: '1.25rem 1rem'
              }}
            >
              {/* Menu Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '1.25rem',
                paddingBottom: '0.875rem',
                borderBottom: '1px solid rgba(255,255,255,0.08)'
              }}>
                <span style={{
                  fontSize: '14px',
                  fontWeight: 800,
                  color: '#f1f5f9',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <Sparkles style={{ width: 16, height: 16, color: '#818cf8' }} />
                  المراكز والوظائف
                </span>
                <button
                  onClick={() => setMobileOpen(false)}
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px',
                    padding: '6px',
                    cursor: 'pointer',
                    color: '#94a3b8'
                  }}
                  aria-label="إغلاق"
                >
                  <X style={{ width: 16, height: 16 }} />
                </button>
              </div>

              {/* Navigation Groups Accordion */}
              <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {NAV_GROUPS.map((group) => {
                  const Icon = group.icon;
                  const active = isGroupActive(group);
                  const isExpanded = mobileExpandedGroup === group.id || active;

                  // Single Link (e.g. History)
                  if (group.href) {
                    return (
                      <Link
                        key={group.id}
                        href={group.href}
                        onClick={() => setMobileOpen(false)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '12px 14px',
                          borderRadius: '12px',
                          fontSize: '14px',
                          fontWeight: 700,
                          textDecoration: 'none',
                          color: active ? group.color : '#94a3b8',
                          background: active ? `${group.color}15` : 'rgba(255,255,255,0.03)',
                          border: active ? `1px solid ${group.color}35` : '1px solid rgba(148,163,184,0.08)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '10px',
                          background: active ? `${group.color}20` : 'rgba(255,255,255,0.05)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <Icon style={{ width: 18, height: 18, color: active ? group.color : '#94a3b8' }} />
                        </div>
                        <span style={{ flex: 1 }}>{group.label}</span>
                      </Link>
                    );
                  }

                  // Group Accordion Item
                  return (
                    <div 
                      key={group.id}
                      style={{
                        borderRadius: '14px',
                        background: 'rgba(255,255,255,0.02)',
                        border: active 
                          ? `1px solid ${group.color}35` 
                          : '1px solid rgba(148,163,184,0.08)',
                        overflow: 'hidden'
                      }}
                    >
                      <button
                        onClick={() => toggleMobileGroup(group.id)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '12px 14px',
                          background: active ? `${group.color}12` : 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          textAlign: 'right',
                          color: active ? group.color : '#f1f5f9'
                        }}
                      >
                        <div style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '10px',
                          background: active ? `${group.color}20` : 'rgba(255,255,255,0.05)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0
                        }}>
                          <Icon style={{ width: 18, height: 18, color: active ? group.color : '#94a3b8' }} />
                        </div>
                        <span style={{ flex: 1, fontSize: '14px', fontWeight: 700 }}>
                          {group.label}
                        </span>
                        <ChevronDown style={{
                          width: 16,
                          height: 16,
                          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s ease',
                          color: '#64748b'
                        }} />
                      </button>

                      {/* Sub-items list */}
                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            style={{
                              borderTop: '1px solid rgba(255,255,255,0.06)',
                              padding: '6px 8px 10px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '4px'
                            }}
                          >
                            {group.items?.map((sub) => {
                              const SubIcon = sub.icon;
                              const isSubActive = pathname === sub.href;
                              return (
                                <Link
                                  key={sub.href}
                                  href={sub.href}
                                  onClick={() => setMobileOpen(false)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '10px 12px',
                                    borderRadius: '10px',
                                    textDecoration: 'none',
                                    background: isSubActive ? `${group.color}20` : 'transparent',
                                    color: isSubActive ? '#fff' : '#94a3b8',
                                    border: isSubActive ? `1px solid ${group.color}40` : '1px solid transparent'
                                  }}
                                >
                                  <SubIcon style={{ 
                                    width: 16, 
                                    height: 16, 
                                    color: isSubActive ? group.color : '#64748b' 
                                  }} />
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '13px', fontWeight: 700 }}>{sub.label}</div>
                                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{sub.desc}</div>
                                  </div>
                                  {sub.badge && (
                                    <span style={{
                                      fontSize: '9px',
                                      fontWeight: 800,
                                      padding: '2px 6px',
                                      borderRadius: '6px',
                                      background: `${group.color}25`,
                                      color: group.color
                                    }}>
                                      {sub.badge}
                                    </span>
                                  )}
                                </Link>
                              );
                            })}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </nav>

              {/* Footer */}
              <div style={{
                marginTop: '1.5rem',
                paddingTop: '1rem',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                textAlign: 'center'
              }}>
                <span style={{
                  fontSize: '11px',
                  color: '#475569',
                  fontWeight: 600
                }}>
                  منظومة تدقيق الموظفين PRO © 2026
                </span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
