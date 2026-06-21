'use client';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Settings, LogOut, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { clearAccessToken } from '@/lib/auth';
import { useT } from '@/lib/i18n/LanguageContext';
import styles from './TeacherNav.module.css';

export default function TeacherNav() {
  const pathname = usePathname();
  const router   = useRouter();
  const t = useT();

  async function handleLogout() {
    try { await api.auth.logout(); } catch {}
    clearAccessToken();
    router.push('/login');
  }

  return (
    <nav className={styles.nav}>
      <div className={styles.left}>
        <Link href="/teacher" className={styles.logo}>
          <div className={styles.logoIcon}><Zap size={13} strokeWidth={2.5} /></div>
          <span className={styles.logoText}>Yool AI</span>
        </Link>
        <div className={styles.divider} />
        <div className={styles.links}>
          <Link href="/teacher"
            className={[styles.link, pathname === '/teacher' ? styles.active : ''].join(' ')}>
            {t('sidebar.myCourses')}
          </Link>
          <Link href="/teacher/sessions"
            className={[styles.link, pathname.startsWith('/teacher/sessions') ? styles.active : ''].join(' ')}>
            {t('nav.sessions')}
          </Link>
        </div>
      </div>
      <div className={styles.right}>
        <Link href="/settings" className={styles.iconBtn} title={t('nav.settings')} aria-label={t('nav.settings')}>
          <Settings size={16} strokeWidth={1.75} />
        </Link>
        <button onClick={handleLogout} className={styles.logoutBtn} aria-label={t('nav.logout')}>
          <LogOut size={14} strokeWidth={1.75} />
          {t('sidebar.logout')}
        </button>
      </div>
    </nav>
  );
}
