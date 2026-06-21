'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error:', error);
  }, [error]);

  return (
    <div className="error-root">
      <div className="error-icon" aria-hidden="true">
        <AlertTriangle size={24} strokeWidth={2} />
      </div>
      <h1 className="error-title">Something went wrong</h1>
      <p className="error-desc">
        {getErrorMessage(error, 'An unexpected error occurred.')}
      </p>
      <div className="error-actions">
        <button onClick={reset} className="error-btn-primary">
          Try again
        </button>
        <Link href="/login" className="error-btn-secondary">
          Go to login
        </Link>
      </div>

      <style jsx>{`
        .error-root {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: var(--bg);
          padding: 24px;
          text-align: center;
        }
        .error-icon {
          width: 56px;
          height: 56px;
          border-radius: 14px;
          background: var(--danger-dim);
          border: 1px solid color-mix(in srgb, var(--danger) 28%, transparent);
          color: var(--danger);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
        }
        .error-title {
          font-size: 18px;
          font-weight: 600;
          color: var(--heading);
          margin-bottom: 8px;
          letter-spacing: -0.015em;
        }
        .error-desc {
          font-size: 13.5px;
          color: var(--text-2);
          margin-bottom: 24px;
          max-width: 360px;
          line-height: 1.55;
        }
        .error-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: center;
        }
        .error-btn-primary,
        .error-btn-secondary {
          height: 38px;
          padding: 0 18px;
          border-radius: var(--r-md);
          font-size: 13px;
          font-weight: 500;
          font-family: inherit;
          display: inline-flex;
          align-items: center;
          text-decoration: none;
          cursor: pointer;
          transition: background-color var(--t-fast), border-color var(--t-fast);
        }
        .error-btn-primary {
          background: var(--accent);
          color: #fff;
          border: 1px solid var(--accent);
        }
        .error-btn-primary:hover { background: var(--accent-h); border-color: var(--accent-h); }
        .error-btn-secondary {
          background: var(--surface);
          color: var(--text-2);
          border: 1px solid var(--border);
        }
        .error-btn-secondary:hover { color: var(--text); border-color: var(--border-2); }
      `}</style>
    </div>
  );
}
