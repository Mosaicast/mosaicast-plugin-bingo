// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { useState } from 'react';
import { PAD, tipBeside, useWidth } from './kit';

/** One line on the chart. `values` is aligned with the chart's x positions; `null` leaves a gap. */
export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
  /** The reader's own line: drawn heavier, and labelled at its end. */
  emphasis?: boolean;
}

const HEIGHT = 220;

/**
 * Several series over the same x positions, on one y axis. The marks follow the dataviz specs: 2px lines
 * with round joins, 8px end and point markers ringed in the surface colour, a hairline grid, and a
 * crosshair tooltip per x position that lists every drawn series — focusable, so it works without a mouse.
 *
 * `invert` puts the smallest value on top, for places (1st at the top).
 */
export function LineChart({
  xLabels,
  xTitles,
  series,
  ticks,
  format,
  invert = false,
  label,
  directLabels,
}: {
  xLabels: string[];
  /** The full name of each x position, for the tooltip and keyboard focus. */
  xTitles: string[];
  series: LineSeries[];
  ticks: number[];
  format: (v: number) => string;
  invert?: boolean;
  /** What the chart shows, for assistive tech. */
  label: string;
  /** Names at the line ends; worth it for a few lines, noise past four. */
  directLabels: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = xLabels.length;
  if (n === 0) return null;

  // A phone has no room for names beside the plot; the legend below carries them there.
  const wantLabels = directLabels && width >= 480;
  const right = PAD.right + (wantLabels ? 96 : 0);
  const plotW = Math.max(80, width - PAD.left - right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / n;
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const x = (i: number) => PAD.left + band * i + band / 2;
  const y = (v: number) => {
    const t = hi === lo ? 0 : (v - lo) / (hi - lo);
    return PAD.top + plotH * (invert ? t : 1 - t);
  };
  const labelEvery = Math.max(1, Math.ceil(40 / band));

  const paths = series.map((s) => {
    let d = '';
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });

  const lastOf = (s: LineSeries) => {
    for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null) return i;
    return -1;
  };
  // End labels only while they stay apart. Nudging colliding ones detaches them from their lines, so when
  // two would overlap they all go, and the legend and tooltip carry identity instead.
  const ends = series
    .map((s) => lastOf(s))
    .map((i, k) => (i < 0 ? null : { x: x(i), y: y(series[k].values[i]!) }));
  const apart = ends.every((a, j) =>
    ends.every((b, k) => k <= j || !a || !b || Math.abs(a.x - b.x) > 60 || Math.abs(a.y - b.y) >= 14),
  );
  const labelled = wantLabels && apart;

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
        {xLabels.map((l, i) =>
          i % labelEvery === 0 ? (
            <text key={i} className="bingo__axis" x={x(i)} y={HEIGHT - 6} textAnchor="middle">
              {l}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <line className="bingo__crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} />
        )}
        {series.map((s, k) => (
          <g key={s.key} className={s.emphasis ? 'bingo__series bingo__series--me' : 'bingo__series'}>
            <path d={paths[k]} fill="none" stroke={s.color} strokeWidth={s.emphasis ? 3 : 2}
              strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) =>
              v === null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={hover === i || n <= 12 ? 4 : 0}
                  fill={s.color} stroke="var(--mc-surface)" strokeWidth={2} />
              ),
            )}
            {labelled && lastOf(s) >= 0 && (
              <text className="bingo__end-label" x={x(lastOf(s)) + 8} y={y(s.values[lastOf(s)]!) + 4}>
                {s.label}
              </text>
            )}
          </g>
        ))}
        {xLabels.map((_, i) => (
          <rect
            key={i}
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
        <div className="bingo__tip" style={tipBeside(x(hover) - band / 2, x(hover) + band / 2, width, PAD.top)}>
          <div className="bingo__tip-title">{xTitles[hover]}</div>
          {series
            .filter((s) => s.values[hover] !== null)
            .sort((a, b) => (invert ? 1 : -1) * ((a.values[hover] ?? 0) - (b.values[hover] ?? 0)))
            .map((s) => (
              <div key={s.key} className="bingo__tip-row">
                <span>
                  <span className="bingo__swatch" style={{ background: s.color }} aria-hidden="true" />
                  {s.label}
                </span>
                <span>{format(s.values[hover]!)}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
