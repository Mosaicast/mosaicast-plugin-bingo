// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useState } from 'react';
import { PAD, roundedTop, tipBeside, useWidth } from './kit';

/** One layer of the bars: drawn bottom up in the order given. */
export interface BarStack {
  key: string;
  label: string;
  color: string;
  values: number[];
}

const HEIGHT = 170;
/** The surface gap between stacked segments. */
const GAP = 2;

/**
 * Columns over x positions, single or stacked, on one y axis from zero. Columns are at most 24px wide with a
 * 4px rounded data end and a 2px surface gap between segments; a dashed reference line can mark an average.
 * Hovering or focusing a column shows its values.
 */
export function BarChart({
  xLabels,
  xTitles,
  stacks,
  ticks,
  format,
  label,
  reference,
}: {
  xLabels: string[];
  xTitles: string[];
  stacks: BarStack[];
  ticks: number[];
  format: (v: number) => string;
  label: string;
  /** A horizontal line across the plot, e.g. the average, with its own label. */
  reference?: { value: number; label: string };
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = xLabels.length;
  if (n === 0) return null;

  const plotW = Math.max(80, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / n;
  const barW = Math.max(2, Math.min(24, band * 0.7));
  const hi = ticks[ticks.length - 1] || 1;
  const y = (v: number) => PAD.top + plotH * (1 - v / hi);
  const labelEvery = Math.max(1, Math.ceil(40 / band));

  return (
    <div className="bingo__chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="bingo__grid-line" x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} />
            <text className="bingo__axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {xLabels.map((_, i) => {
          const x0 = PAD.left + band * i + (band - barW) / 2;
          let base = PAD.top + plotH;
          const parts = stacks.filter((s) => s.values[i] > 0);
          return (
            <g key={i}>
              {parts.map((s, j) => {
                const h = Math.max(0, (s.values[i] / hi) * plotH - (j > 0 ? GAP : 0));
                base -= h + (j > 0 ? GAP : 0);
                const top = j === parts.length - 1;
                return top ? (
                  <path key={s.key} d={roundedTop(x0, base, barW, h)} fill={s.color} />
                ) : (
                  <rect key={s.key} x={x0} y={base} width={barW} height={h} fill={s.color} />
                );
              })}
            </g>
          );
        })}
        {reference && (
          <g>
            <line className="bingo__reference" x1={PAD.left} x2={PAD.left + plotW} y1={y(reference.value)}
              y2={y(reference.value)} />
            <text className="bingo__axis" x={PAD.left + plotW} y={y(reference.value) - 4} textAnchor="end">
              {reference.label}
            </text>
          </g>
        )}
        {xLabels.map((l, i) =>
          i % labelEvery === 0 ? (
            <text key={`x${i}`} className="bingo__axis" x={PAD.left + band * i + band / 2} y={HEIGHT - 6}
              textAnchor="middle">
              {l}
            </text>
          ) : null,
        )}
        {xLabels.map((_, i) => (
          <rect
            key={`h${i}`}
            className="bingo__hit"
            x={PAD.left + band * i}
            y={PAD.top}
            width={band}
            height={plotH}
            tabIndex={0}
            aria-label={xTitles[i]}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div className="bingo__tip"
          style={tipBeside(PAD.left + band * hover, PAD.left + band * (hover + 1), width, PAD.top)}>
          <div className="bingo__tip-title">{xTitles[hover]}</div>
          {stacks.map((s) => (
            <div key={s.key} className="bingo__tip-row">
              <span>
                {stacks.length > 1 && (
                  <span className="bingo__swatch" style={{ background: s.color }} aria-hidden="true" />
                )}
                {s.label}
              </span>
              <span>{format(s.values[hover])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
