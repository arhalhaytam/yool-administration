import styles from './SectionHeader.module.css';

interface SectionHeaderProps {
  title: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  variant?: 'default' | 'danger';
  /** inline = inside cards; panel = standalone block */
  tone?: 'inline' | 'panel';
  className?: string;
}

export default function SectionHeader({
  title,
  subtitle,
  action,
  variant = 'default',
  tone = 'inline',
  className = '',
}: SectionHeaderProps) {
  return (
    <div
      className={[
        styles.header,
        tone === 'panel' ? styles.panel : styles.inline,
        variant === 'danger' ? styles.danger : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.left}>
        <h2 className={styles.title}>
          <span className={styles.accentDot} aria-hidden="true" />
          <span className={styles.titleText}>{title}</span>
        </h2>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
