// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import {
  flushMockApi,
  makeMockCtx,
  makeMockDocs,
  type MockPluginContext,
} from '@mosaicast/plugin-sdk/testing';

/**
 * Settles the mock API and the microtask hops a component adds on top of it.
 *
 * The mock resolves before a component's own `.then(setState)` runs, so a bare `await Promise.resolve()`
 * covers one hop and not two — and the symptom is an assertion that fails only sometimes, depending on how
 * many hops the component happens to take that render.
 */
export async function flush(ctx?: MockPluginContext) {
  await act(async () => {
    if (ctx) await flushMockApi(ctx.api);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** A batch read's path as `readEpisode` builds it: `data/<type>?ids=<id,…>&keys=<key,…>`. */
const BATCH_PATH = /^data\/([a-z]+)\?ids=([^&]*)&keys=(.*)$/;

/**
 * `makeMockCtx`, with the host's batch read answered from the same store as `ctx.docs`.
 *
 * The tile reads its episode through `ctx.api` (see `readEpisode`), and the SDK's mock `api` knows nothing
 * of the mock doc store: without this a test would seed a document in one double and read it from the
 * other. Routing the batch path to `docs.getMany` keeps one store, so a document a component writes with
 * `ctx.docs.put` is what its next read sees — exactly as on the host. Every batch read is still recorded
 * in `ctx.api.calls`, so a test can count requests.
 *
 * @param overrides the same overrides `makeMockCtx` takes; `docs` defaults to an empty mock store
 */
export function makeBingoCtx(overrides: Parameters<typeof makeMockCtx>[0] = {}) {
  const docs = overrides.docs ?? makeMockDocs();
  const ctx = makeMockCtx({ ...overrides, docs });
  const cannedGet = ctx.api.get.bind(ctx.api);

  ctx.api.get = (async (path: string) => {
    const batch = BATCH_PATH.exec(path);
    if (!batch) {
      return cannedGet(path);
    }
    ctx.api.calls.push({ method: 'get', path });
    const [, type, ids, keys] = batch;
    return docs.getMany(
      type as 'episode',
      ids.split(',').map(decodeURIComponent),
      keys.split(','),
    );
  }) as typeof ctx.api.get;

  return ctx;
}
