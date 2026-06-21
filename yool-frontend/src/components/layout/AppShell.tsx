'use client';
/**
 * AppShell — composes the application chrome (sidebar + mobile top bar + main).
 *
 * Why a separate client component?
 *   The route-level layouts (admin/layout.tsx, teacher/layout.tsx) are kept
 *   as server components so they can host the auth guard and other server
 *   concerns. The drawer open/close state lives here, in a focused client
 *   boundary, so we don't pay the "use client" cost for the whole route tree.
 *
 * Drawer behaviour:
 *   - On viewports < 768 px the sidebar is mounted as a slide-in drawer with
 *     a scrim overlay. The MobileTopBar exposes the hamburger trigger.
 *   - On ≥ 768 px the drawer state is ignored; the sidebar is rendered as a
 *     sticky column.
 *   - The drawer auto-closes on: route change, scrim click, Escape, viewport
 *     growing past 768 px.
 */
import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import MobileTopBar from './MobileTopBar';
import adminStyles from '@/app/admin/layout.module.css';
import teacherStyles from '@/app/teacher/layout.module.css';

interface AppShellProps {
  role: 'admin' | 'teacher';
  children: React.ReactNode;
}

const MOBILE_BREAKPOINT = 768; // px — sidebar becomes a drawer below this

export default function AppShell({ role, children }: AppShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const styles = role === 'admin' ? adminStyles : teacherStyles;

  const openDrawer  = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Auto-close on route change (e.g. user taps a nav item in the drawer).
  useEffect(() => { closeDrawer(); }, [pathname, closeDrawer]);

  // Auto-close + body-scroll-lock while drawer is open on mobile.
  useEffect(() => {
    if (!drawerOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    const handleResize = () => {
      if (window.innerWidth >= MOBILE_BREAKPOINT) closeDrawer();
    };

    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleResize);

    // Lock body scroll behind the drawer
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleResize);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawerOpen, closeDrawer]);

  return (
    <div className={styles.layout}>
      <Sidebar role={role} mobileOpen={drawerOpen} onMobileClose={closeDrawer} />
      <main className={styles.main}>
        <MobileTopBar onMenuClick={openDrawer} role={role} />
        <div className={styles.contentAlign}>
          <div className={`${styles.content} ui-page`}>{children}</div>
        </div>
      </main>
    </div>
  );
}
