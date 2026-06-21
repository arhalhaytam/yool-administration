'use client';
/**
 * ResponsiveTable — a data display primitive that adapts to viewport width.
 *
 * Two layouts share one declarative column definition:
 *   - Desktop (≥ breakpoint): traditional HTML <table> with the columns in
 *     order. Rows are full-width and horizontally scrollable if needed.
 *   - Mobile (< breakpoint): each row becomes a stacked card with the column
 *     header as the field label and the cell as the value. Tap-friendly,
 *     scannable, and never overflows.
 *
 * Why a single declarative API?
 *   The previous codebase had bespoke <table> markup repeated in every page,
 *   which made the "table → cards on mobile" pattern essentially impossible
 *   to apply consistently. Wrapping the column model behind a small primitive
 *   means every list page gets the same responsive behaviour for free.
 *
 * Usage:
 *   <ResponsiveTable
 *     columns={[
 *       { id: 'name', header: 'Name', cell: u => u.full_name, primary: true },
 *       { id: 'role', header: 'Role', cell: u => <Badge>{u.role}</Badge> },
 *       { id: 'joined', header: 'Joined', cell: u => fmtDate(u.created_at), hideOnMobile: true },
 *       { id: 'actions', header: '', cell: u => <Actions u={u} />, align: 'end' },
 *     ]}
 *     data={users}
 *     getRowKey={u => u.id}
 *     loading={loading}
 *     emptyState={<EmptyState .../>}
 *   />
 *
 * Column flags:
 *   - primary: highlighted in card mode (larger font, top of card).
 *   - hideOnMobile: omitted entirely from the card view.
 *   - align: 'start' | 'center' | 'end' for table cell alignment.
 */
import type { ReactNode } from 'react';
import styles from './ResponsiveTable.module.css';

export interface TableColumn<T> {
  id: string;
  /** Header text shown in desktop <th> and as the field label in card mode. */
  header: ReactNode;
  /** Renders the cell for a given row. Return null/undefined for empty. */
  cell: (row: T, rowIndex: number) => ReactNode;
  /** Highlighted at the top of the card on mobile. Use for the row's
   *  identifying field (name, title, etc.). */
  primary?: boolean;
  /** Omit this column entirely from the mobile card view. Use for low-density
   *  fields like timestamps or IDs that aren't worth showing on small screens. */
  hideOnMobile?: boolean;
  /** Horizontal alignment in the desktop <td>. */
  align?: 'start' | 'center' | 'end';
  /** Optional className applied to the <th> and <td>. */
  className?: string;
  /** Suppress the field label on mobile (useful for an "actions" column). */
  unlabeledOnMobile?: boolean;
}

export interface ResponsiveTableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string | number;
  /** Optional click handler — turns each row into a button. */
  onRowClick?: (row: T) => void;
  /** Show skeleton rows while data is loading. */
  loading?: boolean;
  /** Number of skeleton rows to show while loading. Defaults to 4. */
  loadingRows?: number;
  /** Rendered when data is empty and not loading. */
  emptyState?: ReactNode;
  /** Optional className applied to the outer wrapper. */
  className?: string;
}

export default function ResponsiveTable<T>({
  columns,
  data,
  getRowKey,
  onRowClick,
  loading = false,
  loadingRows = 4,
  emptyState,
  className,
}: ResponsiveTableProps<T>) {
  const mobileColumns = columns.filter(c => !c.hideOnMobile);

  if (loading && data.length === 0) {
    return (
      <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
        {/* Desktop skeleton */}
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {columns.map(col => (
                  <th key={col.id} className={alignClass(col.align, col.className)}>
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: loadingRows }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={columns.length} className={styles.skeletonRow}>
                    <span className={`skeleton-line ${styles.skeletonBar}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile skeleton */}
        <div className={styles.cardList} aria-hidden="true">
          {Array.from({ length: loadingRows }).map((_, i) => (
            <div key={i} className={styles.card}>
              <span className={`skeleton-line ${styles.skeletonCardBar}`} />
              <span className={`skeleton-line ${styles.skeletonCardBar}`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!loading && data.length === 0 && emptyState) {
    return <div className={[styles.wrap, className].filter(Boolean).join(' ')}>{emptyState}</div>;
  }

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      {/* ── Desktop / tablet: traditional table ─────────────── */}
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map(col => (
                <th key={col.id} className={alignClass(col.align, col.className)}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const RowTag = onRowClick ? 'tr' : 'tr';
              return (
                <RowTag
                  key={getRowKey(row, i)}
                  className={[
                    styles.row,
                    onRowClick ? styles.rowClickable : '',
                  ].join(' ')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{ animationDelay: `${i * 24}ms` }}
                >
                  {columns.map(col => (
                    <td key={col.id} className={alignClass(col.align, col.className)}>
                      {col.cell(row, i)}
                    </td>
                  ))}
                </RowTag>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Mobile: stacked cards ─────────────────────────── */}
      <div className={styles.cardList}>
        {data.map((row, i) => (
          <div
            key={getRowKey(row, i)}
            className={[
              styles.card,
              onRowClick ? styles.cardClickable : '',
            ].join(' ')}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            style={{ animationDelay: `${i * 30}ms` }}
          >
            {mobileColumns.map(col => {
              const value = col.cell(row, i);
              if (value == null || value === '' || value === false) return null;
              return (
                <div
                  key={col.id}
                  className={[
                    styles.field,
                    col.primary ? styles.fieldPrimary : '',
                  ].join(' ')}
                >
                  {!col.unlabeledOnMobile && !col.primary && (
                    <span className={styles.fieldLabel}>{col.header}</span>
                  )}
                  <span className={styles.fieldValue}>{value}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function alignClass(align: TableColumn<unknown>['align'], extra?: string): string {
  const base =
    align === 'center' ? styles.alignCenter :
    align === 'end'    ? styles.alignEnd    :
                         '';
  return [base, extra].filter(Boolean).join(' ');
}
