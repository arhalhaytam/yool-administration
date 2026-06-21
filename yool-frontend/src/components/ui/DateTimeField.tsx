'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import {
  compareLocalDateTime,
  daysInMonth,
  formatDisplayDateTime,
  getYearRange,
  parseLocalDateTime,
  toLocalDateTimeString,
} from '@/lib/datetime-local';
import { useLocale, useT } from '@/lib/i18n/LanguageContext';
import styles from './DateTimeField.module.css';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

type CalendarView = 'days' | 'month' | 'year';

interface DateTimeFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  min?: string;
  max?: string;
}

function clampDraftToBounds(
  draft: Date,
  min?: string,
  max?: string,
): Date {
  let d = draft;
  const minD = min ? parseLocalDateTime(min) : null;
  const maxD = max ? parseLocalDateTime(max) : null;
  if (minD && d < minD) d = minD;
  if (maxD && d > maxD) d = maxD;
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

function isDayDisabled(
  year: number,
  month: number,
  day: number,
  min?: string,
  max?: string,
): boolean {
  const probe = toLocalDateTimeString(
    new Date(year, month, day, 23, 59, 0, 0),
  );
  const probeStart = toLocalDateTimeString(
    new Date(year, month, day, 0, 0, 0, 0),
  );
  if (min && compareLocalDateTime(probe, min) < 0) return true;
  if (max && compareLocalDateTime(probeStart, max) > 0) return true;
  return false;
}

export default function DateTimeField({
  id,
  value,
  onChange,
  placeholder = '',
  disabled = false,
  min,
  max,
}: DateTimeFieldProps) {
  const t = useT();
  const { locale, isRTL } = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(() => new Date());
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [calendarView, setCalendarView] = useState<CalendarView>('days');
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const shellRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const yearListRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const yearRange = getYearRange(min, max);
  const years = Array.from(
    { length: yearRange.to - yearRange.from + 1 },
    (_, i) => yearRange.from + i,
  );
  const monthNames = Array.from({ length: 12 }, (_, monthIndex) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-FR' : 'en-US', { month: 'short' }).format(
      new Date(2000, monthIndex, 1),
    ),
  );
  const weekdays = Array.from({ length: 7 }, (_, dayIndex) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'short' }).format(
      new Date(2024, 0, dayIndex + 7),
    ),
  );

  const selected = parseLocalDateTime(value);
  const today = new Date();

  const openPicker = useCallback(() => {
    if (disabled) return;
    const base = selected ?? new Date();
    setDraft(base);
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
    setCalendarView('days');
    setOpen(true);
  }, [disabled, selected]);

  const commit = useCallback(
    (d: Date) => {
      const clamped = clampDraftToBounds(d, min, max);
      onChange(toLocalDateTimeString(clamped));
    },
    [onChange, min, max],
  );

  const updateDraft = useCallback(
    (next: Date) => {
      const clamped = clampDraftToBounds(next, min, max);
      setDraft(clamped);
      if (clamped.getFullYear() !== viewYear || clamped.getMonth() !== viewMonth) {
        setViewYear(clamped.getFullYear());
        setViewMonth(clamped.getMonth());
      }
    },
    [min, max, viewYear, viewMonth],
  );

  const positionPopover = useCallback(() => {
    const el = shellRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 24);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) {
      left = window.innerWidth - width - 12;
    }
    left = Math.max(12, left);

    const popH = popoverRef.current?.offsetHeight ?? 320;
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const top =
      spaceBelow >= popH || spaceBelow >= spaceAbove
        ? rect.bottom + 8
        : rect.top - popH - 8;

    setPopoverStyle({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    positionPopover();
    const onResize = () => positionPopover();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, positionPopover, viewYear, viewMonth, calendarView]);

  useEffect(() => {
    if (calendarView !== 'year' || !yearListRef.current) return;
    const active = yearListRef.current.querySelector(
      `[data-year="${viewYear}"]`,
    );
    active?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [calendarView, viewYear, open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (shellRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (calendarView !== 'days') {
          e.preventDefault();
          setCalendarView('days');
          return;
        }
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, calendarView]);

  function selectDay(year: number, month: number, day: number) {
    if (isDayDisabled(year, month, day, min, max)) return;
    const next = new Date(draft);
    next.setFullYear(year, month, day);
    updateDraft(next);
  }

  function selectHour(h: number) {
    const next = new Date(draft);
    next.setHours(h);
    updateDraft(next);
  }

  function selectMinute(m: number) {
    const next = new Date(draft);
    next.setMinutes(m);
    updateDraft(next);
  }

  function buildCalendarCells() {
    const firstDow = new Date(viewYear, viewMonth, 1).getDay();
    const total = daysInMonth(viewYear, viewMonth);
    const cells: { day: number; month: number; year: number; outside: boolean }[] = [];

    const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
    const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
    const prevTotal = daysInMonth(prevYear, prevMonth);

    for (let i = firstDow - 1; i >= 0; i -= 1) {
      cells.push({
        day: prevTotal - i,
        month: prevMonth,
        year: prevYear,
        outside: true,
      });
    }
    for (let d = 1; d <= total; d += 1) {
      cells.push({ day: d, month: viewMonth, year: viewYear, outside: false });
    }
    const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
    const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
    let d = 1;
    while (cells.length % 7 !== 0) {
      cells.push({ day: d, month: nextMonth, year: nextYear, outside: true });
      d += 1;
    }
    return cells;
  }

  const popover =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            className={styles.popover}
            style={popoverStyle}
            role="dialog"
            aria-modal="true"
            aria-labelledby={listId}
          >
            <span id={listId} className="sr-only">
              {placeholder || t('datetime.selectDateTime')}
            </span>
            <div className={styles.pickerBody}>
              <div className={styles.calendarPane}>
                <div className={styles.calHeader}>
                  {calendarView === 'days' ? (
                    <>
                  <button
                    type="button"
                    className={styles.navBtn}
                    aria-label={t('datetime.previousMonth')}
                    onClick={() => {
                      if (viewMonth === 0) {
                        setViewYear((y) => y - 1);
                        setViewMonth(11);
                      } else setViewMonth((m) => m - 1);
                    }}
                  >
                    {isRTL ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                  </button>
                  <div className={styles.calTitleGroup}>
                    <button
                      type="button"
                      className={styles.titleBtn}
                      onClick={() => setCalendarView('month')}
                    >
                      {monthNames[viewMonth]}
                      <ChevronDown size={12} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={`${styles.titleBtn} ${styles.titleBtnYear}`}
                      onClick={() => setCalendarView('year')}
                    >
                      {viewYear}
                      <ChevronDown size={12} aria-hidden />
                    </button>
                  </div>
                  <button
                    type="button"
                    className={styles.navBtn}
                    aria-label={t('datetime.nextMonth')}
                    onClick={() => {
                      if (viewMonth === 11) {
                        setViewYear((y) => y + 1);
                        setViewMonth(0);
                      } else setViewMonth((m) => m + 1);
                    }}
                  >
                    {isRTL ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
                  </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.navBtn}
                        aria-label={t('datetime.backToCalendar')}
                        onClick={() => setCalendarView('days')}
                      >
                        {isRTL ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
                      </button>
                      <span className={styles.calTitle}>
                        {calendarView === 'year'
                          ? t('datetime.selectYear')
                          : `${t('datetime.selectMonth')} · ${viewYear}`}
                      </span>
                      <span className={styles.headerSpacer} aria-hidden />
                    </>
                  )}
                </div>
                {calendarView === 'days' && (
                  <>
                <div className={styles.weekdays}>
                  {weekdays.map((w) => (
                    <span key={w} className={styles.weekday}>
                      {w}
                    </span>
                  ))}
                </div>
                <div className={styles.days} role="grid">
                  {buildCalendarCells().map((cell) => {
                    const cellDate = new Date(
                      cell.year,
                      cell.month,
                      cell.day,
                    );
                    const selectedDay = isSameDay(cellDate, draft);
                    const todayDay = isSameDay(cellDate, today);
                    const off = isDayDisabled(
                      cell.year,
                      cell.month,
                      cell.day,
                      min,
                      max,
                    );
                    return (
                      <button
                        key={`${cell.year}-${cell.month}-${cell.day}-${cell.outside ? 'o' : 'i'}`}
                        type="button"
                        role="gridcell"
                        className={[
                          styles.day,
                          cell.outside ? styles.dayOutside : '',
                          todayDay ? styles.dayToday : '',
                          selectedDay ? styles.daySelected : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        disabled={off}
                        onClick={() =>
                          selectDay(cell.year, cell.month, cell.day)
                        }
                      >
                        {cell.day}
                      </button>
                    );
                  })}
                </div>
                  </>
                )}

                {calendarView === 'month' && (
                  <div className={styles.monthGrid} role="listbox" aria-label="Month">
                    {monthNames.map((label, monthIndex) => (
                      <button
                        key={label}
                        type="button"
                        role="option"
                        aria-selected={viewMonth === monthIndex}
                        className={[
                          styles.monthCell,
                          viewMonth === monthIndex ? styles.monthCellActive : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          setViewMonth(monthIndex);
                          setCalendarView('days');
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}

                {calendarView === 'year' && (
                  <div
                    ref={yearListRef}
                    className={styles.yearList}
                    role="listbox"
                    aria-label="Year"
                  >
                    {years.map((y) => (
                      <button
                        key={y}
                        type="button"
                        role="option"
                        data-year={y}
                        aria-selected={viewYear === y}
                        className={[
                          styles.yearOption,
                          viewYear === y ? styles.yearOptionActive : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          setViewYear(y);
                          setCalendarView('month');
                        }}
                      >
                        {y}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.timePane}>
                <div className={styles.timeLabel}>{t('datetime.time')}</div>
                <div className={styles.timeColumns}>
                  <div className={styles.timeCol}>
                    <span className={styles.timeColTitle}>{t('datetime.hour')}</span>
                    <div className={styles.timeList} role="listbox" aria-label={t('datetime.hour')}>
                      {HOURS.map((h) => (
                        <button
                          key={h}
                          type="button"
                          role="option"
                          aria-selected={draft.getHours() === h}
                          className={[
                            styles.timeOption,
                            draft.getHours() === h ? styles.timeOptionActive : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => selectHour(h)}
                        >
                          {String(h).padStart(2, '0')}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.timeCol}>
                    <span className={styles.timeColTitle}>{t('datetime.minute')}</span>
                    <div className={styles.timeList} role="listbox" aria-label={t('datetime.minute')}>
                      {MINUTES.map((m) => (
                        <button
                          key={m}
                          type="button"
                          role="option"
                          aria-selected={draft.getMinutes() === m}
                          className={[
                            styles.timeOption,
                            draft.getMinutes() === m ? styles.timeOptionActive : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => selectMinute(m)}
                        >
                          {String(m).padStart(2, '0')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.popoverFooter}>
              <button
                type="button"
                className={styles.footerBtn}
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                {t('datetime.clear')}
              </button>
              <button
                type="button"
                className={styles.footerBtn}
                onClick={() => {
                  const now = clampDraftToBounds(new Date(), min, max);
                  updateDraft(now);
                }}
              >
                {t('datetime.now')}
              </button>
              <button
                type="button"
                className={[styles.footerBtn, styles.footerBtnPrimary].join(' ')}
                onClick={() => {
                  commit(draft);
                  setOpen(false);
                }}
              >
                {t('datetime.done')}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={shellRef}
      className={[styles.shell, open ? styles.open : ''].filter(Boolean).join(' ')}
      data-open={open ? 'true' : undefined}
    >
      <button
        type="button"
        id={id}
        className={styles.trigger}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPicker())}
      >
        <Calendar size={14} className={styles.icon} aria-hidden />
        <span
          className={value ? '' : styles.triggerPlaceholder}
        >
          {value ? formatDisplayDateTime(value) : (placeholder || t('datetime.selectDateTime'))}
        </span>
        <Clock size={13} className={`${styles.icon} ${styles.iconRight}`} aria-hidden />
      </button>
      {popover}
    </div>
  );
}
