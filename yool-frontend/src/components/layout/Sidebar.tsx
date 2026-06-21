'use client';
import { useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, BookOpen, Video, Users, Search,
  ShieldCheck, Settings, LogOut, GraduationCap,
  ChevronsLeft, ChevronsRight, Layers, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { clearAccessToken } from '@/lib/auth';
import { useConfirm } from '@/components/ui/Confirm';
import { useT } from '@/lib/i18n/LanguageContext';
import type { User } from '@/lib/types';
import YoolMark from '@/components/brand/YoolMark';
import styles from './Sidebar.module.css';

interface NavItem {
  href: string;
  icon: LucideIcon;
  tKey: string;   // key inside sidebar.*
  exact?: boolean;
}

interface NavSection {
  id: string;
  tKey: string;
  items: NavItem[];
}

const ADMIN_SECTIONS: NavSection[] = [
  {
    id: 'overview', tKey: 'overview',
    items: [{ href: '/admin', icon: LayoutDashboard, tKey: 'dashboard', exact: true }],
  },
  {
    id: 'teaching', tKey: 'teaching',
    items: [
      { href: '/admin/curriculum', icon: Layers,   tKey: 'curriculum' },
      { href: '/admin/courses',    icon: BookOpen, tKey: 'courses'    },
      { href: '/admin/sessions',   icon: Video,    tKey: 'sessions'   },
    ],
  },
  {
    id: 'directory', tKey: 'directory',
    items: [{ href: '/admin/users', icon: Users, tKey: 'users' }],
  },
  {
    id: 'insights', tKey: 'insights',
    items: [{ href: '/admin/search', icon: Search, tKey: 'search' }],
  },
  {
    id: 'security', tKey: 'security',
    items: [{ href: '/admin/audit-log', icon: ShieldCheck, tKey: 'auditLog' }],
  },
];

const TEACHER_SECTIONS: NavSection[] = [
  {
    id: 'overview', tKey: 'overview',
    items: [
      { href: '/teacher',          icon: LayoutDashboard, tKey: 'dashboard', exact: true },
    ],
  },
  {
    id: 'workspace', tKey: 'workspace',
    items: [
      { href: '/teacher/courses',  icon: GraduationCap, tKey: 'myCourses' },
      { href: '/teacher/sessions', icon: Video,         tKey: 'sessions'  },
    ],
  },
];

interface SidebarProps {
  role: 'admin' | 'teacher';
  /** When true on mobile viewports, the sidebar is rendered as an open drawer.
   *  Ignored at ≥ 768 px — the sticky desktop layout takes precedence. */
  mobileOpen?: boolean;
  /** Callback to close the drawer (used by scrim, close button, link clicks). */
  onMobileClose?: () => void;
}

const STORAGE_KEY = 'sidebar_collapsed';

function getInitials(name: string, email: string): string {
  const source = (name || email || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function roleLabel(role: string, t: (key: string) => string): string {
  if (role === 'super_admin') return t('admin.role.super_admin');
  if (role === 'admin')       return t('admin.role.admin');
  return t('admin.role.teacher');
}

export default function Sidebar({ role, mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const router   = useRouter();
  const { confirm } = useConfirm();
  const t = useT();

  const sections = role === 'admin' ? ADMIN_SECTIONS : TEACHER_SECTIONS;
  const s = (key: string) => t(`sidebar.${key}`);

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === 'true';
  });

  const [me, setMe] = useState<User | null>(null);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-w', collapsed ? '72px' : '248px',
    );
    localStorage.setItem(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    let cancelled = false;
    api.auth.me()
      .then(u => { if (!cancelled) setMe(u); })
      .catch(() => { /* silent — sidebar still works without identity */ });
    return () => { cancelled = true; };
  }, []);

  async function handleLogout() {
    const confirmed = await confirm(
      s('logout'),
      t('auth.sessionExpired'),
      { confirmLabel: s('logout'), cancelLabel: t('common.cancel'), variant: 'danger' }
    );
    if (!confirmed) return;
    try { await api.auth.logout(); } catch { /* still clear */ }
    clearAccessToken();
    router.push('/login');
  }

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href);

  const displayName = me?.full_name || me?.email || '';
  const initials    = me ? getInitials(me.full_name, me.email) : '·';

  return (
    <>
      {/* Scrim — only rendered when the drawer is open on mobile. */}
      <div
        className={[styles.scrim, mobileOpen ? styles.scrimOpen : ''].join(' ')}
        onClick={onMobileClose}
        aria-hidden="true"
      />

      <aside
        className={[
          styles.sidebar,
          collapsed ? styles.collapsed : '',
          mobileOpen ? styles.mobileOpen : '',
        ].join(' ')}
        aria-label="Primary navigation"
      >
      {/* ── Brand (with close button on mobile) ─────────────── */}
      <div className={styles.brand}>
        <span className={styles.brandLogo} aria-hidden="true">
          <YoolMark size={26} strokeWidth={2.2} accentNode />
        </span>
        {!collapsed && (
          <div className={styles.brandText}>
            <span className={styles.brandName}>Yool</span>
            <span className={styles.brandRole}>{roleLabel(role, t)}</span>
          </div>
        )}
        {/* Close button — visible only when drawer is open on mobile. */}
        <button
          type="button"
          className={styles.drawerClose}
          onClick={onMobileClose}
          aria-label={t('common.close')}
        >
          <X size={18} strokeWidth={2} />
        </button>
      </div>

      <div className={styles.divider} aria-hidden="true" />

      {/* ── Nav ───────────────────────────────────────────────── */}
      <nav className={styles.nav} aria-label="Primary">
        {sections.map((section, si) => (
          <div key={section.id} className={styles.navSection}>
            {!collapsed && (
              <div
                className={[styles.sectionLabel, si === 0 ? styles.sectionLabelFirst : ''].join(' ')}
                role="presentation"
                aria-hidden="true"
              >
                <span>{s(section.tKey)}</span>
              </div>
            )}
            {section.items.map(item => {
              const Icon   = item.icon;
              const active = isActive(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[styles.item, active ? styles.active : ''].join(' ')}
                  title={collapsed ? s(item.tKey) : undefined}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className={styles.activeLine} aria-hidden="true" />
                  <Icon size={17} strokeWidth={active ? 2 : 1.6} className={styles.icon} />
                  {!collapsed && <span className={styles.label}>{s(item.tKey)}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ── Footer: identity + actions ───────────────────────── */}
      <div className={styles.footer}>
        <div className={styles.divider} aria-hidden="true" />

        {/* User identity */}
        <Link
          href="/settings"
          className={[
            styles.userCard,
            pathname === '/settings' ? styles.userCardActive : '',
          ].join(' ')}
          title={collapsed ? displayName : undefined}
          aria-label={displayName ? `${displayName} — ${s('settings')}` : s('settings')}
        >
          <div className={styles.avatar} aria-hidden="true">{initials}</div>
          {!collapsed && (
            <div className={styles.userMeta}>
              <span className={styles.userName}>{displayName || '—'}</span>
              <span className={styles.userRole}>{roleLabel(role, t)}</span>
            </div>
          )}
          {!collapsed && (
            <Settings size={14} strokeWidth={1.7} className={styles.userCardIcon} />
          )}
        </Link>

        {/* Action row: logout + collapse */}
        <div className={styles.actions}>
          <button
            type="button"
            onClick={handleLogout}
            className={styles.actionBtn}
            title={s('logout')}
            aria-label={s('logout')}
          >
            <LogOut size={15} strokeWidth={1.7} />
            {!collapsed && <span>{s('logout')}</span>}
          </button>

          <button
            type="button"
            className={[styles.actionBtn, styles.collapseBtn].join(' ')}
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? s('expand') : s('collapse')}
            aria-label={collapsed ? s('expand') : s('collapse')}
            aria-pressed={collapsed ? 'true' : 'false'}
          >
            {collapsed
              ? <ChevronsRight size={15} strokeWidth={1.7} />
              : <ChevronsLeft  size={15} strokeWidth={1.7} />
            }
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}
