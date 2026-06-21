/** Utilities for `datetime-local` values: `YYYY-MM-DDTHH:mm` (local). */

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toLocalDateTimeString(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function parseLocalDateTime(value: string): Date | null {
  if (!value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    0,
    0,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDisplayDateTime(value: string): string {
  const d = parseLocalDateTime(value);
  if (!d) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function compareLocalDateTime(a: string, b: string): number {
  const da = parseLocalDateTime(a);
  const db = parseLocalDateTime(b);
  if (!da && !db) return 0;
  if (!da) return -1;
  if (!db) return 1;
  return da.getTime() - db.getTime();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export function monthYearLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

/** Inclusive year range for pickers (audit logs may need several years back). */
export function getYearRange(min?: string, max?: string): { from: number; to: number } {
  const now = new Date().getFullYear();
  let from = now - 12;
  let to = now + 1;

  const minD = min ? parseLocalDateTime(min) : null;
  const maxD = max ? parseLocalDateTime(max) : null;
  if (minD) from = Math.min(from, minD.getFullYear());
  if (maxD) to = Math.max(to, maxD.getFullYear());

  return { from, to };
}
