// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

describe('copyText', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'clipboard', original);
    else delete (navigator as { clipboard?: unknown }).clipboard;
    vi.restoreAllMocks();
  });

  it('uses the clipboard API where the origin offers it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    expect(await copyText('https://x/p/bingo/draft/1')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://x/p/bingo/draft/1');
  });

  it('selects the field and runs the copy command where it does not, as on plain http', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const exec = vi.fn().mockReturnValue(true);
    (document as { execCommand: unknown }).execCommand = exec;
    const field = document.createElement('input');
    field.value = 'http://lan:8281/p/bingo/draft/1?code=c';
    document.body.appendChild(field);

    expect(await copyText(field.value, field)).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    field.remove();
  });

  it('says so when nothing worked', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    (document as { execCommand: unknown }).execCommand = vi.fn().mockReturnValue(false);
    expect(await copyText('x')).toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
