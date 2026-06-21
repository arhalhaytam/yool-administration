/**
 * Icon — lightweight inline SVG icon set.
 * Consistent 24×24 viewBox, 1.5px stroke, round caps.
 * No external dependency — all paths are hand-optimised.
 */

import React from 'react';

interface IconProps {
  size?: number;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

const base = (size: number, color: string, children: React.ReactNode) => (
  <svg
    width={size} height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const CalendarIcon = ({ size = 16, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>)}
  </span>
);

export const ClockIcon = ({ size = 16, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>)}
  </span>
);

export const GlobeIcon = ({ size = 16, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8M3.6 15h16.8" />
      <path d="M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18" />
    </>)}
  </span>
);

export const TagIcon = ({ size = 16, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <path d="M12 2H7a2 2 0 0 0-2 2v5l8.59 8.59a2 2 0 0 0 2.82 0l4.59-4.59a2 2 0 0 0 0-2.82z" />
      <circle cx="7.5" cy="7.5" r="1" fill={color} stroke="none" />
    </>)}
  </span>
);

export const MicIcon = ({ size = 24, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="9" y1="22" x2="15" y2="22" />
    </>)}
  </span>
);

export const UserIcon = ({ size = 16, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </>)}
  </span>
);

export const TeacherIcon = ({ size = 16, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <path d="M22 10v1a10 10 0 0 1-20 0v-1" />
      <path d="M12 2l8 4-8 4-8-4 8-4z" />
      <path d="M12 12v4" />
      <path d="M9.5 16.5c0 .83 1.12 1.5 2.5 1.5s2.5-.67 2.5-1.5" />
    </>)}
  </span>
);

export const HelpCircleIcon = ({ size = 16, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3" />
      <circle cx="12" cy="17" r=".5" fill={color} stroke="none" />
    </>)}
  </span>
);

export const FileTextIcon = ({ size = 24, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="12" y2="17" />
    </>)}
  </span>
);

export const DownloadIcon = ({ size = 16, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>)}
  </span>
);

export const SearchIcon = ({ size = 14, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>)}
  </span>
);

export const RadioIcon = ({ size = 10, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <circle cx="12" cy="12" r="4" fill={color} stroke="none" />
      <circle cx="12" cy="12" r="9" />
    </>)}
  </span>
);

export const ChevronRightIcon = ({ size = 14, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <polyline points="9 18 15 12 9 6" />)}
  </span>
);

export const RefreshIcon = ({ size = 14, color = 'currentColor', className, style }: IconProps) => (
  <span className={className} style={style}>
    {base(size, color, <>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </>)}
  </span>
);
