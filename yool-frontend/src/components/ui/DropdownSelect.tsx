'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import styles from './DropdownSelect.module.css';

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface DropdownGroup {
  label: string;
  options: DropdownOption[];
}

interface DropdownSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options?: DropdownOption[];
  groups?: DropdownGroup[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  variant?: 'default' | 'bare';
  mono?: boolean;
  menuPlacement?: 'below' | 'above';
  portal?: boolean;
  error?: boolean;
  'aria-labelledby'?: string;
}

function flattenOptions(
  options?: DropdownOption[],
  groups?: DropdownGroup[],
): DropdownOption[] {
  if (groups?.length) return groups.flatMap((g) => g.options);
  return options ?? [];
}

export default function DropdownSelect({
  id,
  value,
  onChange,
  options,
  groups,
  placeholder = 'Select…',
  disabled = false,
  className = '',
  variant = 'default',
  mono = false,
  menuPlacement = 'below',
  portal = false,
  error = false,
  'aria-labelledby': ariaLabelledby,
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const allOptions = useMemo(
    () => flattenOptions(options, groups),
    [options, groups],
  );

  const enabledOptions = useMemo(
    () => allOptions.filter((o) => !o.disabled),
    [allOptions],
  );

  const selected = allOptions.find((o) => o.value === value);
  const displayLabel = selected?.label ?? placeholder;

  const close = useCallback(() => {
    setOpen(false);
    setHighlight(-1);
  }, []);

  const selectValue = useCallback(
    (next: string) => {
      onChange(next);
      close();
    },
    [onChange, close],
  );

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const width = Math.round(rect.width);
    const isRTL = document?.documentElement?.getAttribute('dir') === 'rtl';
    const left = Math.round(rect.left);
    const right = Math.max(0, Math.round(window.innerWidth - rect.right));
    if (menuPlacement === 'above') {
      setMenuStyle({
        position: 'fixed',
        ...(isRTL ? { right } : { left }),
        width: 'max-content',
        minWidth: width,
        maxWidth: 'calc(100vw - 40px)',
        bottom: window.innerHeight - rect.top + gap,
        zIndex: 10000,
      });
    } else {
      setMenuStyle({
        position: 'fixed',
        ...(isRTL ? { right } : { left }),
        width: 'max-content',
        minWidth: width,
        maxWidth: 'calc(100vw - 40px)',
        top: rect.bottom + gap,
        zIndex: 10000,
      });
    }
  }, [menuPlacement]);

  useLayoutEffect(() => {
    if (!open || !portal) return;
    positionMenu();
    const onReposition = () => positionMenu();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, portal, positionMenu]);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const idx = enabledOptions.findIndex((o) => o.value === value);
    setHighlight(idx >= 0 ? idx : 0);
  }, [open, enabledOptions, value]);

  useEffect(() => {
    if (!open || highlight < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-option-index="${highlight}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight]);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  function onTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) positionMenu();
      setOpen(true);
    }
  }

  function onListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((i) => Math.min(i + 1, enabledOptions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlight >= 0) {
      e.preventDefault();
      selectValue(enabledOptions[highlight].value);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setHighlight(enabledOptions.length - 1);
    }
  }

  let optionIndex = -1;

  function renderOption(opt: DropdownOption) {
    if (opt.disabled) {
      return (
        <li key={`${opt.value}-disabled`} role="presentation">
          <button type="button" className={styles.option} disabled>
            <span className={styles.optionLabel}>{opt.label}</span>
          </button>
        </li>
      );
    }
    optionIndex += 1;
    const idx = optionIndex;
    const isSelected = opt.value === value;
    const isHighlighted = open && idx === highlight;
    return (
      <li key={opt.value || '__all__'} role="presentation">
        <button
          type="button"
          role="option"
          aria-selected={isSelected}
          data-option-index={idx}
          className={[
            styles.option,
            mono ? styles.optionMono : '',
            isSelected ? styles.optionSelected : '',
            isHighlighted ? styles.optionHighlighted : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onMouseEnter={() => setHighlight(idx)}
          onClick={() => selectValue(opt.value)}
        >
          <span className={styles.optionLabel}>{opt.label}</span>
          <Check size={14} className={styles.optionCheck} aria-hidden />
        </button>
      </li>
    );
  }

  const rootClass = [
    styles.root,
    variant === 'bare' ? styles.bare : '',
    open ? styles.open : '',
    mono ? styles.mono : '',
    error ? styles.hasError : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const isPlaceholder = !selected;

  return (
    <div
      ref={rootRef}
      className={rootClass}
      data-open={open ? 'true' : undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={error || undefined}
        aria-labelledby={ariaLabelledby}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((wasOpen) => {
            if (!wasOpen) positionMenu();
            return !wasOpen;
          });
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span
          className={[styles.triggerText, isPlaceholder ? styles.placeholder : '']
            .filter(Boolean)
            .join(' ')}
        >
          {displayLabel}
        </span>
        <ChevronDown size={14} className={styles.chevron} aria-hidden />
      </button>

      {open && (() => {
        const menu = (
          <div
            ref={menuRef}
            className={[
              styles.menu,
              portal ? styles.menuPortaled : '',
              !portal && menuPlacement === 'above' ? styles.menuUp : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={portal ? menuStyle : undefined}
          >
            <ul
              ref={listRef}
              className={styles.list}
              role="listbox"
              aria-labelledby={ariaLabelledby}
              tabIndex={-1}
              onKeyDown={onListKeyDown}
            >
              {groups?.length
                ? groups.map((group) => (
                    <li key={group.label} className={styles.group} role="presentation">
                      <span className={styles.groupLabel}>{group.label}</span>
                      <ul role="group" aria-label={group.label}>
                        {group.options.map((opt) => renderOption(opt))}
                      </ul>
                    </li>
                  ))
                : (options ?? []).map((opt) => renderOption(opt))}
            </ul>
          </div>
        );
        return portal && typeof document !== 'undefined'
          ? createPortal(menu, document.body)
          : menu;
      })()}
    </div>
  );
}
