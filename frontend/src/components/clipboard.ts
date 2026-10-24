// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * Copies text to the clipboard, from a click.
 *
 * `navigator.clipboard` exists only on a secure origin: https, or `localhost`. A site opened over plain http
 * under any other name (a LAN address, a test host) has none, and Firefox enforces that, so the async API
 * alone left the copy buttons dead there while selecting the text and pressing Ctrl+C still worked. The
 * fallback does what that keystroke does: select the text and run the copy command, which every browser
 * still honours inside a click.
 *
 * @param text  what to copy
 * @param field the input showing the text, if there is one: it gets selected, so a failed copy leaves the
 *              reader one Ctrl+C away
 * @returns whether the text reached the clipboard
 */
export async function copyText(text: string, field?: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused (a permission, a lost click): try the old way below.
  }
  if (field) {
    field.focus();
    field.select();
    return runCopy();
  }
  // Nothing on screen to select: a throwaway field outside any shadow root, selected and copied.
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = runCopy();
  area.remove();
  return copied;
}

function runCopy(): boolean {
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
}
