/**
 * YoolMark — the Yool AI brand glyph.
 *
 * Design intent:
 *   Two converging strokes flow into a single vertical stem (a stylised "Y"),
 *   with one filled node anchoring the upper-right arm. The asymmetry encodes
 *   "multiple inputs distil into one focused output" — the core action of the
 *   product (audio + curriculum → summary). The node is the only filled mass,
 *   so the mark reads cleanly at small sizes (16 px favicon) and at hero scale
 *   (80 px login).
 *
 * Usage:
 *   <YoolMark />                         // 24 px, currentColor stroke
 *   <YoolMark size={36} />               // any size
 *   <YoolMark size={20} accent />        // node + paths share the accent color
 *   <YoolMark size={40} className=".." />
 *
 *   Wrap in a styled element to control color via `color` (currentColor).
 */
import type { CSSProperties } from 'react';

interface YoolMarkProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  /**
   * If true, the filled node uses var(--accent) regardless of currentColor.
   * Useful when the mark is rendered in a muted color but the node should
   * still pop with the accent.
   */
  accentNode?: boolean;
  title?: string;
}

export default function YoolMark({
  size = 24,
  strokeWidth = 2.2,
  className,
  style,
  accentNode = false,
  title = 'Yool',
}: YoolMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
      style={style}
    >
      {/* Left arm — converges into the stem at (16, 17) */}
      <path
        d="M7 6.5 L16 17"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Right arm — terminates at the node (25, 6.5) */}
      <path
        d="M25 6.5 L16 17"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Vertical stem */}
      <path
        d="M16 17 L16 26"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Output node — the only filled element; anchors the composition */}
      <circle
        cx="25"
        cy="6.5"
        r={strokeWidth * 1.1}
        fill={accentNode ? 'var(--accent)' : 'currentColor'}
      />
    </svg>
  );
}
