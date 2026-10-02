// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The bundle is loaded straight into the browser (no consumer bundler), so bake NODE_ENV in — otherwise
  // the bundled React references `process.env.NODE_ENV` and throws `process is not defined` at load.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/bingo-element.tsx'),
      formats: ['es'],
      fileName: () => 'bingo.es.js',
    },
    // No `rollupOptions.external` — React and the SDK must be bundled (not shared with the host), so this
    // plugin never collides with the host's own React instance or SDK version.
  },
});
