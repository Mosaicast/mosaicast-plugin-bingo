// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { BarChart } from './BarChart';
import { MIN_BAND, minChartWidth } from './kit';

async function draw(n: number) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const labels = Array.from({ length: n }, (_, i) => `E${i + 1}`);
  await act(async () => {
    root.render(
      <BarChart xLabels={labels} xTitles={labels} ticks={[0, 5]} format={String} label="Cards per bingo"
        scrollLabel="Cards per bingo, scrolls sideways"
        stacks={[{ key: 'c', label: 'Cards', color: 'red', values: labels.map(() => 3) }]} />,
    );
  });
  return { host, done: () => { act(() => root.unmount()); host.remove(); } };
}

describe('<BarChart> frame', () => {
  // jsdom lays nothing out, so the chart is given its fallback room of 640px.
  it('fits a short season into the room it has', async () => {
    const { host, done } = await draw(6);
    const frame = host.querySelector('.bingo__chart-scroll')!;
    expect(frame.classList.contains('bingo__chart-scroll--on')).toBe(false);
    expect(frame.getAttribute('tabindex')).toBeNull();
    expect(host.querySelector('.bingo__chart svg')?.getAttribute('viewBox')).toBe('0 0 640 170');
    expect(host.querySelector('.bingo__chart-axis')).toBeNull();
    done();
  });

  it('scrolls sideways instead of squeezing a long one, and says so', async () => {
    const { host, done } = await draw(40);
    const frame = host.querySelector('.bingo__chart-scroll')!;
    expect(frame.classList.contains('bingo__chart-scroll--on')).toBe(true);
    expect(frame.getAttribute('tabindex')).toBe('0');
    expect(frame.getAttribute('aria-label')).toBe('Cards per bingo, scrolls sideways');
    expect(host.querySelector('.bingo__chart svg')?.getAttribute('viewBox')).toBe(`0 0 ${minChartWidth(40)} 170`);
    expect(minChartWidth(40)).toBeGreaterThan(40 * MIN_BAND);
    expect(host.querySelector('.bingo__chart-axis')?.textContent).toBe('05'); // the values stay pinned at the left
    done();
  });
});
