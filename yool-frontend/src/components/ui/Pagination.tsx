'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/LanguageContext';
import styles from './Pagination.module.css';

export type PaginationProps = {
  offset: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  onPageChange: (newOffset: number) => void;
  /** Shown after the range, e.g. "courses" or "users" */
  itemLabel?: string;
};

export function getPageInfo(offset: number, pageSize: number, total: number, pageLength: number) {
  if (total === 0) {
    return { pageStart: 0, pageEnd: 0, currentPage: 1, totalPages: 1 };
  }
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;
  const pageStart = offset + 1;
  const pageEnd = Math.min(offset + pageLength, total);
  return { pageStart, pageEnd, currentPage, totalPages };
}

export default function Pagination({
  offset,
  pageSize,
  total,
  loading = false,
  onPageChange,
  itemLabel = 'items',
}: PaginationProps) {
  const t = useT();
  const { isRTL } = useLocale();
  if (total <= 0) return null;

  const pageLength = Math.min(pageSize, Math.max(0, total - offset));
  const { pageStart, pageEnd, currentPage, totalPages } = getPageInfo(
    offset,
    pageSize,
    total,
    pageLength,
  );

  const hasPrev = offset > 0;
  const hasNext = offset + pageLength < total;
  const showDots = totalPages > 1 && totalPages <= 7;
  const pages = showDots ? Array.from({ length: totalPages }, (_, i) => i + 1) : [];

  return (
    <nav
      className={[styles.bar, loading ? styles.barLoading : ''].filter(Boolean).join(' ')}
      aria-label="Pagination"
    >
      <div className={styles.meta}>
        <span className={styles.range}>
          {pageStart}–{pageEnd} {t('pagination.of')} {total.toLocaleString()} {itemLabel}
        </span>
        <span className={styles.hint}>
          {t('pagination.page')} {currentPage} {t('pagination.of')} {totalPages}
        </span>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.navBtn}
          disabled={!hasPrev || loading}
          onClick={() => onPageChange(Math.max(0, offset - pageSize))}
        >
          {isRTL ? <ChevronRight size={15} strokeWidth={2} /> : <ChevronLeft size={15} strokeWidth={2} />}
          <span className="label">{t('common.previous')}</span>
        </button>

        {showDots && (
          <div className={styles.pageDots} aria-hidden>
            {pages.map(p => {
              const active = p === currentPage;
              return (
                <button
                  key={p}
                  type="button"
                  className={[styles.dot, active ? styles.dotActive : ''].filter(Boolean).join(' ')}
                  disabled={loading || active}
                  onClick={() => onPageChange((p - 1) * pageSize)}
                  aria-label={`${t('pagination.page')} ${p}`}
                  aria-current={active ? 'page' : undefined}
                />
              );
            })}
          </div>
        )}

        <button
          type="button"
          className={styles.navBtn}
          disabled={!hasNext || loading}
          onClick={() => onPageChange(offset + pageSize)}
        >
          <span className="label">{t('common.next')}</span>
          {isRTL ? <ChevronLeft size={15} strokeWidth={2} /> : <ChevronRight size={15} strokeWidth={2} />}
        </button>
      </div>
    </nav>
  );
}
