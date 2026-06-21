'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard, BookOpen, Video, Users,
  Search, Shield, Settings, LogOut, Zap
} from 'lucide-react';
import { api } from '@/lib/api';
import { clearAccessToken } from '@/lib/auth';
import { useT } from '@/lib/i18n/LanguageContext';
import styles from './AdminSidebar.module.css';

export default function AdminSidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const t = useT();

  const NAV = [
    { href: '/admin',           icon: LayoutDashboard, label: t('sidebar.dashboard')  },
    { href: '/admin/courses',   icon: BookOpen,        label: t('sidebar.courses')    },
    { href: '/admin/sessions',  icon: Video,           label: t('sidebar.sessions')   },
    { href: '/admin/users',     icon: Users,           label: t('sidebar.users')      },
    { href: '/admin/search',    icon: Search,          label: t('sidebar.search')     },
    { href: '/admin/audit-log', icon: Shield,          label: t('sidebar.auditLog')   },
  ];

  async function handleLogout() {
    try { await api.auth.logout(); } catch {}
    clearAccessToken();
    router.push('/login');
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}><Zap size={14} strokeWidth={2.5} /></div>
        <span className={styles.logoText}>Yool AI</span>
      </div>

      <nav className={styles.nav}>
        <div className={styles.navGroup}>
          {NAV.map(({ href, icon: Icon, label }) => {
            const active = href === '/admin'
              ? pathname === '/admin'
              : pathname.startsWith(href);
            return (
              <Link key={href} href={href}
                className={[styles.item, active ? styles.active : ''].join(' ')}>
                <Icon size={15} strokeWidth={active ? 2 : 1.75} className={styles.icon} />
                <span>{label}</span>
                {active && <span className={styles.activePip} />}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className={styles.footer}>
        <Link href="/settings" className={styles.item}>
          <Settings size={15} strokeWidth={1.75} className={styles.icon} />
          <span>{t('sidebar.settings')}</span>
        </Link>
        <button onClick={handleLogout} className={[styles.item, styles.logout].join(' ')}>
          <LogOut size={15} strokeWidth={1.75} className={styles.icon} />
          <span>{t('sidebar.logout')}</span>
        </button>
      </div>
    </aside>
  );
}
