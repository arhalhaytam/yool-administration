import Link from 'next/link';
import styles from './PageHeader.module.css';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  border?: boolean;
  breadcrumbs?: BreadcrumbItem[];
}

export default function PageHeader({
  title,
  subtitle,
  action,
  border = true,
  breadcrumbs,
}: PageHeaderProps) {
  return (
    <header className={styles.header}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
          {breadcrumbs.map((item, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <span key={index} className={styles.breadcrumbItem}>
                {index > 0 && <span className={styles.separator}>/</span>}
                {item.href && !isLast ? (
                  <Link href={item.href} className={styles.link}>
                    {item.label}
                  </Link>
                ) : (
                  <span className={styles.current}>{item.label}</span>
                )}
              </span>
            );
          })}
        </nav>
      )}

      <div className={styles.inner}>
        <div className={styles.titleBlock}>
          <span className={styles.accent} aria-hidden="true" />
          <div className={styles.text}>
            <h1 className={styles.title}>{title}</h1>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
        </div>
        {action && <div className={styles.action}>{action}</div>}
      </div>
      {border && <hr className={styles.divider} />}
    </header>
  );
}