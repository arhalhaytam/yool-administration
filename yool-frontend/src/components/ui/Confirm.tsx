'use client';
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import styles from './Confirm.module.css';

export type ConfirmVariant = 'primary' | 'danger' | 'warning';

interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
}

interface ConfirmContextProps {
  confirm: (title: string, message: string, options?: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextProps | undefined>(undefined);

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  return context;
}

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: ConfirmVariant;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const confirm = useCallback(
    (title: string, message: string, options?: ConfirmOptions) => {
      return new Promise<boolean>((resolve) => {
        setState({
          isOpen: true,
          title,
          message,
          confirmLabel: options?.confirmLabel || 'Confirm',
          cancelLabel: options?.cancelLabel || 'Cancel',
          variant: options?.variant || 'primary',
          resolve,
        });
      });
    },
    []
  );

  const handleCancel = () => {
    if (state) {
      state.resolve(false);
      setState(null);
    }
  };

  const handleConfirm = () => {
    if (state) {
      state.resolve(true);
      setState(null);
    }
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {mounted && state && (
        <ConfirmDialog
          state={state}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
        />
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmDialog({
  state,
  onCancel,
  onConfirm,
}: {
  state: ConfirmState;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { title, message, confirmLabel, cancelLabel, variant } = state;

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const getIcon = () => {
    if (variant === 'danger' || variant === 'warning') {
      return (
        <div className={[styles.iconContainer, styles.dangerIcon].join(' ')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
      );
    }
    return (
      <div className={[styles.iconContainer, styles.primaryIcon].join(' ')}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </div>
    );
  };

  return createPortal(
    <div className={styles.overlay} onClick={onCancel} role="presentation">
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
      >
        <div className={styles.header}>
          {getIcon()}
          <div className={styles.headerText}>
            <h3 id="confirm-title" className={styles.title}>{title}</h3>
            <p id="confirm-desc" className={styles.message}>{message}</p>
          </div>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={[styles.confirmBtn, styles[variant]].join(' ')}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
