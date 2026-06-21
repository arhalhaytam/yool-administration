import styles from './Badge.module.css';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'accent' | 'purple';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  pulse?: boolean;
}

export default function Badge({ children, variant = 'default', dot = false, pulse = false }: BadgeProps) {
  return (
    <span className={[styles.badge, styles[variant]].join(' ')}>
      {dot && <span className={[styles.dot, pulse ? styles.pulse : ''].join(' ')} />}
      {children}
    </span>
  );
}
