import { AlertCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import styles from './FormAlert.module.css';

type FormAlertVariant = 'error' | 'success' | 'warning';

interface FormAlertProps {
  variant?: FormAlertVariant;
  message: string;
  className?: string;
  role?: 'alert' | 'status';
}

const ICONS = {
  error: AlertCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
} as const;

export default function FormAlert({
  variant = 'error',
  message,
  className = '',
  role = 'alert',
}: FormAlertProps) {
  if (!message.trim()) return null;
  const Icon = ICONS[variant];
  return (
    <div
      className={[styles.alert, styles[variant], className].filter(Boolean).join(' ')}
      role={role}
      aria-live="polite"
    >
      <Icon size={15} className={styles.icon} aria-hidden />
      <span className={styles.message}>{message}</span>
    </div>
  );
}
