// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Small pieces every chart here shares, adapted from `mosaicast-plugin-stats` so the two plugins' charts
 * behave alike: measure the width and draw at it, put the tooltip beside the hovered band, round a bar's
 * data end only.
 */

/** The width an element is drawn at, kept current. Charts draw in real pixels, so text stays text-sized. */
export function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(w);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** How wide a tooltip is assumed to be when choosing a side for it. */
const TIP_WIDTH = 200;

/** Puts a tooltip to the right of a band, or to its left when the right would overflow the chart. */
export function tipBeside(left: number, right: number, width: number, top: number): React.CSSProperties {
  return right + 10 + TIP_WIDTH <= width || left - 10 - TIP_WIDTH < 0
    ? { left: right + 10, top }
    : { left: left - 10, top, transform: 'translateX(-100%)' };
}

/** A bar with a 4px rounded data end and a square base on the baseline. */
export function roundedTop(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** One entry of a legend: a swatch in the series colour, the name in text colour. */
export interface LegendItem {
  key: string;
  label: string;
  color: string;
  /** Drawn as a short line rather than a square, to match a line chart's marks. */
  line?: boolean;
}

export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <div className="bingo__legend">
      {items.map((item) => (
        <span key={item.key} className="bingo__legend-item">
          <span
            className={item.line ? 'bingo__swatch bingo__swatch--line' : 'bingo__swatch'}
            style={{ background: item.color }}
            aria-hidden="true"
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** Space reserved around a plot for its axes. */
export const PAD = { top: 10, right: 12, bottom: 24, left: 36 };

/** The narrowest an x position may get before a chart scrolls sideways instead of squeezing. */
export const MIN_BAND = 28;

/** The width a chart over `n` x positions needs at least, with `extra` beside the plot (direct labels). */
export function minChartWidth(n: number, extra = 0): number {
  return n * MIN_BAND + PAD.left + PAD.right + extra;
}

/**
 * The frame a chart draws in. While the chart fits it is just a box; once it is wider than the room it was
 * given, the frame scrolls sideways — the page itself never widens — and starts at the right-hand end,
 * where the newest bingos are. A scrolling frame is focusable, so the arrow keys move it too. While it
 * scrolls, `axis` stays pinned at its left edge, so the values never scroll away from the bars.
 */
export function ChartFrame({
  frameRef,
  width,
  scrolls,
  label,
  axis,
  children,
}: {
  frameRef: React.RefObject<HTMLDivElement>;
  /** The width the chart is drawn at. */
  width: number;
  scrolls: boolean;
  /** What the chart shows; the frame adds that it scrolls. */
  label: string;
  /** The y axis on its own (see {@link YAxis}), pinned while the chart scrolls. */
  axis?: React.ReactNode;
  children: React.ReactNode;
}) {
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (el && scrolls) el.scrollLeft = el.scrollWidth;
  }, [frameRef, scrolls, width]);
  return (
    <div className="bingo__chart-box">
      {scrolls && axis && <div className="bingo__chart-axis" aria-hidden="true">{axis}</div>}
      <div
        ref={frameRef}
        className={scrolls ? 'bingo__chart-scroll bingo__chart-scroll--on' : 'bingo__chart-scroll'}
        tabIndex={scrolls ? 0 : undefined}
        role={scrolls ? 'group' : undefined}
        aria-label={scrolls ? label : undefined}
      >
        <div className="bingo__chart" style={{ width }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The y axis's values alone, as wide as the chart's left padding: what {@link ChartFrame} pins. */
export function YAxis({ ticks, y, format, height }: {
  ticks: number[];
  y: (v: number) => number;
  format: (v: number) => string;
  height: number;
}) {
  return (
    <svg width={PAD.left} height={height} viewBox={`0 0 ${PAD.left} ${height}`}>
      {ticks.map((t) => (
        <text key={t} className="bingo__axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
          {format(t)}
        </text>
      ))}
    </svg>
  );
}
