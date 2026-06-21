'use client';

import { Children, isValidElement, useMemo, forwardRef } from 'react';
import DropdownSelect from './DropdownSelect';
import type { DropdownOption } from './DropdownSelect';
import styles from './Select.module.css';

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label?: string;
  error?: string;
  hint?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}

function collectOptions(children: React.ReactNode): DropdownOption[] {
  const options: DropdownOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== 'option') return;
    const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
    const raw = props.children;
    const label =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw)
          ? raw.map(String).join('')
          : String(raw ?? '');
    options.push({
      value: String(props.value ?? ''),
      label,
      disabled: props.disabled,
    });
  });
  return options;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      hint,
      className = '',
      id,
      children,
      value = '',
      onChange,
      disabled,
      name,
    },
    _ref,
  ) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    const allOptions = useMemo(() => collectOptions(children), [children]);
    const placeholderOption = allOptions.find((o) => o.value === '' && o.disabled);
    const placeholder = placeholderOption?.label ?? 'Select…';
    const dropdownOptions = useMemo(
      () => allOptions.filter((o) => !(o.value === '' && o.disabled)),
      [allOptions],
    );

    const handleChange = (next: string) => {
      onChange?.({
        target: { value: next, name },
        currentTarget: { value: next, name },
      } as React.ChangeEvent<HTMLSelectElement>);
    };

    return (
      <div className={[styles.wrapper, className].filter(Boolean).join(' ')}>
        {label && (
          <label htmlFor={selectId} className={styles.label}>
            {label}
          </label>
        )}
        <DropdownSelect
          id={selectId}
          value={String(value ?? '')}
          onChange={handleChange}
          options={dropdownOptions}
          placeholder={placeholder}
          disabled={disabled}
          error={!!error}
          portal
        />
        {error && <span className={styles.error}>{error}</span>}
        {hint && !error && <span className={styles.hint}>{hint}</span>}
      </div>
    );
  },
);

Select.displayName = 'Select';
export default Select;
