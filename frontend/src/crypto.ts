// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * The three operations claims need — SHA-256, PBKDF2-HMAC-SHA256 and AES-GCM decryption — wherever the page
 * runs.
 *
 * WebCrypto (`crypto.subtle`) exists only in a secure context: HTTPS, or `localhost`. A site reached over
 * plain HTTP — a self-hosted instance on a LAN address, a phone testing a dev box — has no `crypto.subtle`
 * at all, and a claim that relied on it showed an empty card there. So WebCrypto is used where it exists
 * (fast, native), and the audited, dependency-free `@noble` implementations everywhere else. Both produce
 * the same bytes; the tests run both against the vector the Java side pins.
 */

const encoder = new TextEncoder();

/** WebCrypto, when this page is allowed it. Overridable for tests. */
export let subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle;

/** Test seam: run as an insecure context would. */
export function useSubtle(next: SubtleCrypto | undefined): void {
  subtle = next;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of a string, as lower-case hex. */
export async function sha256Hex(text: string): Promise<string> {
  const data = encoder.encode(text);
  if (subtle) return hex(new Uint8Array(await subtle.digest('SHA-256', data)));
  return hex(sha256(data));
}

/**
 * AES-256-GCM decryption under a PBKDF2-HMAC-SHA256 key. Rejects when the key does not open the data — a
 * wrong code — exactly as WebCrypto does.
 */
export async function pbkdf2AesGcmDecrypt(
  password: string,
  salt: string,
  iterations: number,
  iv: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> {
  if (subtle) {
    const material = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, key, data));
  }
  // Async, so the page stays responsive through the iterations on a slow phone.
  const key = await pbkdf2Async(sha256, encoder.encode(password), encoder.encode(salt), { c: iterations, dkLen: 32 });
  return gcm(key, iv).decrypt(data);
}
