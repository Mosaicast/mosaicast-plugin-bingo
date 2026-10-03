// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { mergePins, pendingPins, splitPin, variantsOf } from './regroup';

const ASSIGNMENTS = {
  'Alex says damn it': 'alex says damn it',
  'alex says damn': 'alex says damn it',
  kraken: 'kraken',
  'giant squid': 'giant squid',
};

describe('regroup', () => {
  it('lists the spellings grouped into one candidate', () => {
    expect(variantsOf(ASSIGNMENTS, 'alex says damn it')).toEqual(['alex says damn', 'Alex says damn it']);
  });

  it('merges by pinning every spelling of a candidate to the target', () => {
    expect(mergePins(ASSIGNMENTS, 'giant squid', 'kraken')).toEqual({ 'giant squid': 'kraken' });
  });

  it('splits by pinning one spelling to nothing', () => {
    expect(splitPin('alex says damn')).toEqual({ 'alex says damn': '' });
  });

  it('knows which pins the backend has not applied yet, from the result rather than a clock', () => {
    const grouping = { pins: { 'giant squid': 'kraken', 'alex says damn': '', gone: 'kraken' } };

    expect(pendingPins(grouping, ASSIGNMENTS)).toEqual(['giant squid', 'alex says damn']);
    expect(
      pendingPins(grouping, {
        ...ASSIGNMENTS,
        'giant squid': 'kraken',
        // A split lands as a group named after the spelling's own normalised form.
        'alex says damn': 'alex says damn',
      }),
    ).toEqual([]);
  });
});
