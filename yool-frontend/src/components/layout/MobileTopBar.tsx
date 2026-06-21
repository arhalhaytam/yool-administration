'use client';
/**
 * MobileTopBar — sticky 56px top bar that replaces the desktop sidebar on
 * viewports below 768 px. Surfaces the brand and a hamburger trigger that
 * opens the sidebar as a slide-in drawer.
 *
 * On ≥ 768 px the bar is hidden by CSS; the desktop sidebar takes over.
 */
import { Menu } from 'lucide-react';
import YoolMark from '@/components/brand/YoolMark';
import { useT } from '@/lib/i18n/LanguageContext';
import styles from './MobileTopBar.module.css';

interface MobileTopBarProps {
  onMenuClick: () => void;
  role: 'admin' | 'teacher';
}

export default function MobileTopBar({ onMenuClick, role }: MobileTopBarProps) {
  const t = useT();
  const roleLabel = role === 'admin' ? t('sidebar.admin') : t('sidebar.instructor');
  return (
    <header className={styles.bar} role="banner">
      <button
        type="button"
        className={styles.menuBtn}
        onClick={onMenuClick}
        aria-label={t('sidebar.expand')}
      >
        <Menu size={20} strokeWidth={2} />
      </button>

      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true">
          <YoolMark size={22} strokeWidth={2.2} accentNode />
        </span>
        <span className={styles.brandWord}>
          Yool<span className={styles.brandPeriod}>.</span>
        </span>
        <span className={styles.brandRole}>{roleLabel}</span>
      </div>
    </header>
  );
}
