import { isValidElement, type ReactNode, type ComponentType } from 'react';
import { Inbox } from 'lucide-react';
import styles from './EmptyState.module.css';

interface EmptyStateProps {
  /**
   * Icon to display above the title. Pass a Lucide icon component (preferred)
   * or any ReactNode. Defaults to a generic empty inbox icon.
   *
   * Examples:
   *   <EmptyState icon={<Inbox size={24} />} title="No data" />
   *   <EmptyState icon={Inbox} title="No data" />            // also accepted
   */
  icon?: ReactNode | ComponentType<{ size?: number; strokeWidth?: number }>;
  title: string;
  description?: string;
  action?: ReactNode;
}

function renderIcon(icon: EmptyStateProps['icon']): ReactNode {
  if (icon == null) {
    return <Inbox size={24} strokeWidth={1.6} />;
  }
  // Already a JSX element (e.g. `<Mic size={20} />` passed inline).
  if (isValidElement(icon)) {
    return icon;
  }
  // Anything else — function components AND forwardRef objects (which are NOT
  // typeof 'function', they are `{ $$typeof, render }` objects). Render them
  // by treating them as a component type.
  if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null)) {
    const IconComponent = icon as ComponentType<{ size?: number; strokeWidth?: number }>;
    return <IconComponent size={24} strokeWidth={1.6} />;
  }
  return null;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.iconWrap} aria-hidden="true">
        {renderIcon(icon)}
      </div>
      <h3 className={styles.title}>{title}</h3>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
