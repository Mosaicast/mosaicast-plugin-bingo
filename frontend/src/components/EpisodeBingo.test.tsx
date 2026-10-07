// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeMockDocs, makeMockEpisode, makeMockTags, makeMockUsers } from '@mosaicast/plugin-sdk/testing';
import { EpisodeBingo } from './EpisodeBingo';
import { flush, makeBingoCtx } from '../test-utils';

/**
 * Component tests against `makeMockCtx`, the SDK's own double — preferred over a hand-rolled context
 * because it stays in step with the contract across SDK bumps and records `api.calls` and `logs` for us.
 */
describe('<EpisodeBingo>', () => {
  const EPISODE = 'ep-1';
  const scope = { type: 'episode' as const, id: EPISODE };

  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const docPath = (key: string) => `data/episode/${EPISODE}/${key}`;

  /** A signed-in fan. Since 0.13.0 `ctx.user` carries the name and picture the shell already knows. */
  const fan = {
    id: 'u1',
    role: 'fan' as const,
    displayName: 'Ned',
    avatarUrl: '/api/users/u1/avatar',
  };

  function ctxWith(docs: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return makeBingoCtx({ scope, docs: makeMockDocs(docs), ...extra });
  }

  const render = async (ctx: ReturnType<typeof makeBingoCtx>) => {
    await act(async () => {
      root.render(<EpisodeBingo ctx={ctx} />);
    });
    await flush(ctx);
  };

  it('says there is no bingo when no template has been written', async () => {
    await render(ctxWith({}));

    expect(host.textContent).toContain('There is no bingo for this episode yet.');
    // A missing document is the normal answer for a bingo nobody has made, not a failure.
    expect(host.textContent).not.toContain('could not be loaded');
  });

  const podcaster = {
    id: 'p1', role: 'podcaster' as const,
    displayName: 'Pod', avatarUrl: '/api/users/p1/avatar',
  };

  it('says a lifecycle change is pending instead of looking dead', async () => {
    // The intent lands at once; the derived phase follows a tick later. Without saying so, the button
    // looks broken for up to a minute and invites pressing it again.
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          [docPath('phase')]: { phase: 'OPEN', suggested: 'OPEN' },
          [docPath('control')]: { phase: 'LOCKED', updatedAt: '2026-09-06T07:00:00Z' },
        },
        { user: podcaster },
      ),
    );

    expect(host.textContent).toContain('applied on the next pass');
    const lock = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Closing'));
    expect(lock).toBeDefined();
    expect((lock as HTMLButtonElement).disabled).toBe(true);
  });

  it('writes the intent when a lifecycle button is pressed', async () => {
    const docs = makeMockDocs({
      [docPath('template')]: { size: 3 },
      [docPath('phase')]: { phase: 'OPEN', suggested: 'OPEN' },
    });
    const ctx = makeBingoCtx({ scope, docs, user: podcaster });
    await render(ctx);

    const lock = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Lock predictions'),
    ) as HTMLButtonElement;
    await act(async () => lock.click());
    await flush(ctx);

    expect(docs.stored[docPath('control')]).toMatchObject({ phase: 'LOCKED' });
  });

  it('leads the tab with the quantity the site actually ranks on', async () => {
    // There is no ctx.config on the frontend, so the setting travels on the leaderboard document.
    await render(
      ctxWith({
        [docPath('template')]: { size: 3 },
        [docPath('leaderboard')]: { published: false, players: 0, rankBy: 'lines' },
      }),
    );
    expect(host.querySelector('.bingo__tab-score')?.textContent).toBe('0/8 lines');
  });

  it('leads the tab with fields when the operator ranks that way', async () => {
    await render(
      ctxWith({
        [docPath('template')]: { size: 3 },
        [docPath('leaderboard')]: { published: false, players: 0, rankBy: 'fields' },
      }),
    );
    expect(host.querySelector('.bingo__tab-score')?.textContent).toBe('0/9 fields');
  });

  it('renders one tab per featured card plus the viewer’s own', async () => {
    // Featured cards are copied out by the backend: no browser can read another person's partition, so
    // without that copy there would be nothing to draw a tab from.
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3, title: 'Bingo' },
          [docPath('showcased')]: {
            items: [
              { userId: 'u2', entries: ['kraken'] },
              { userId: 'u3', entries: ['merch plug'] },
            ],
          },
        },
        { users: makeMockUsers({ u2: 'Alice', u3: 'Bob' }) },
      ),
    );

    const tabs = [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent ?? '');
    expect(tabs.some((t) => t.includes('Alice'))).toBe(true);
    expect(tabs.some((t) => t.includes('Bob'))).toBe(true);
    expect(tabs.some((t) => t.includes('Your bingo'))).toBe(true);
  });

  it('does not draw the viewer their own card twice when it is featured', async () => {
    // Being featured is something other people see. The owner already has their own tab, which is the one
    // carrying the editor and the visibility choices, so a second tab for the same card is just a copy.
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3, title: 'Bingo' },
          [docPath('phase')]: { phase: 'RESOLVED', suggested: 'LOCKED' },
          [docPath('showcased')]: {
            items: [
              { userId: 'u1', entries: ['kraken'] },
              { userId: 'u2', entries: ['merch plug'] },
            ],
          },
        },
        { user: fan, users: makeMockUsers({ u1: 'Ned', u2: 'Alice' }) },
      ),
    );

    const tabs = [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent ?? '');
    expect(tabs.filter((t) => t.includes('Your bingo'))).toHaveLength(1);
    expect(tabs.some((t) => t.includes('Ned')), 'their own card is not also a featured tab').toBe(false);
    expect(tabs.some((t) => t.includes('Alice')), 'somebody else’s still is').toBe(true);
  });

  it('offers a podcaster a way to create a bingo, and nobody else', async () => {
    // Until this existed there was no path at all: the template could only be written by hand through the
    // doc-store API.
    const docs = makeMockDocs({});
    const ctx = makeBingoCtx({
      scope,
      docs,
      user: { id: 'p1', role: 'podcaster', displayName: 'Pod', avatarUrl: '/api/users/p1/avatar' },
    });
    await render(ctx);

    const create = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Create the bingo'),
    ) as HTMLButtonElement;
    expect(create).toBeDefined();

    await act(async () => create.click());
    await flush(ctx);
    expect(docs.stored[docPath('template')]).toMatchObject({ size: 3 });
  });

  it('does not record a free middle square on a grid that has no middle', async () => {
    // The control is disabled on an even grid, but disabling it does not clear what is behind it: ticking
    // the box on 3x3 and then switching to 4x4 used to create a 4x4 claiming a centre it cannot have.
    const docs = makeMockDocs({});
    const ctx = makeBingoCtx({
      scope,
      docs,
      user: { id: 'p1', role: 'podcaster', displayName: 'Pod', avatarUrl: '/api/users/p1/avatar' },
    });
    await render(ctx);

    const box = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => box.click());
    expect(box.checked).toBe(true);

    const select = host.querySelector('select') as HTMLSelectElement;
    await act(async () => {
      select.value = '4';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);

    const create = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Create the bingo'),
    ) as HTMLButtonElement;
    await act(async () => create.click());
    await flush(ctx);

    expect(docs.stored[docPath('template')]).toMatchObject({ size: 4, freeCentre: false });
  });

  it('shows a plain visitor no way to create one', async () => {
    await render(ctxWith({}, { user: fan }));

    expect(host.textContent).toContain('There is no bingo for this episode yet.');
    expect(host.textContent).not.toContain('Create the bingo');
  });

  it('shows the prediction state while the bingo is open', async () => {
    await render(
      ctxWith({
        [docPath('template')]: { size: 3 },
        [docPath('phase')]: { phase: 'OPEN', suggested: 'OPEN' },
      }),
    );

    expect(host.textContent).toContain('Predictions open');
    expect(host.textContent).toContain('Fill in your card before the episode goes live.');
  });

  it('shows the resolution state from the published phase, never from ctx.episode', async () => {
    // `ctx.episode` says where the episode stands, not the bingo: one released episode can carry an open,
    // locked or resolved bingo, depending on what the podcaster asked for.
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          // Released, which suggests a lock — and the podcaster reopened it anyway.
          [docPath('phase')]: { phase: 'OPEN', suggested: 'LOCKED' },
        },
        { episode: makeMockEpisode('released') },
      ),
    );

    expect(host.textContent).toContain('Predictions open');
  });

  const RESOLVED_BINGO = {
    [docPath('template')]: { size: 3 },
    [docPath('phase')]: { phase: 'RESOLVED', suggested: 'LOCKED' },
    [docPath('showcased')]: { items: [{ userId: 'u2', entries: ['Kraken!'] }] },
    [docPath('candidates')]: {
      items: [{ canonical: 'kraken', label: 'Kraken!', count: 1 }],
      assignments: { 'Kraken!': 'kraken' },
    },
    // What a fan is handed: the published answers. The host keeps `resolution` from anyone below podcaster.
    [docPath('answers')]: { hits: { kraken: true } },
  };

  /** Someone who has listened; the default mock reports no stored position at all. */
  const heardIt = { progress: { get: async () => 3600 } };

  it('strikes a completed line through the card, and none through one being written', async () => {
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3, freeCentre: true },
          [docPath('phase')]: { phase: 'RESOLVED', suggested: 'LOCKED' },
          [docPath('candidates')]: { assignments: { a: 'a', b: 'b', c: 'c', d: 'd' } },
          [docPath('answers')]: { hits: { a: true, b: true, c: true, d: true } },
          [`data/user/me/card:${EPISODE}`]: { entries: ['a', 'b', 'c', 'x', 'y', 'z', 'w', 'd'] },
        },
        { user: fan, progress: { get: async () => 3600 } },
      ),
    );
    // The top row (a b c), and the diagonal a · free middle · d.
    expect(host.querySelectorAll('.bingo__strike')).toHaveLength(2);
    expect(host.querySelector('.bingo__strikes')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws no strokes on a card that is still being filled in', async () => {
    await render(ctxWith({ [docPath('template')]: { size: 3 } }, { user: fan }));
    expect(host.querySelector('.bingo__strikes')).toBeNull();
  });

  it('marks entries the resolution says came true', async () => {
    await render(ctxWith(RESOLVED_BINGO, heardIt));

    await act(async () => {
      (host.querySelectorAll('[role="tab"]')[0] as HTMLButtonElement).click();
    });
    expect(host.querySelectorAll('.bingo__cell--hit').length).toBeGreaterThan(0);
  });

  /** A bingo the podcaster is still ticking off, as a fan's batch read returns it: no `resolution`. */
  const LOCKED_BINGO = {
    // No free middle: it is always a hit, and would be counted below.
    [docPath('template')]: { size: 3, freeCentre: false },
    [docPath('phase')]: { phase: 'LOCKED', suggested: 'LOCKED' },
    [docPath('showcased')]: { items: [{ userId: 'u2', entries: ['Kraken!'] }] },
    [docPath('candidates')]: { assignments: { 'Kraken!': 'kraken' } },
    [docPath('answers')]: { hits: {} },
  };

  it('shows the podcaster their ticks as they make them', async () => {
    await render(ctxWith({ ...LOCKED_BINGO, [docPath('resolution')]: { hits: { kraken: true } } },
      { user: podcaster, ...heardIt }));
    await act(async () => (host.querySelector('[role="tab"]') as HTMLButtonElement).click());
    expect(host.querySelectorAll('.bingo__cell--hit')).toHaveLength(1);
  });

  it('shows a fan no hits until the bingo is resolved', async () => {
    // The host floors `resolution` to podcasters, so a half-ticked list never reaches this tile.
    await render(ctxWith(LOCKED_BINGO, { user: fan, ...heardIt }));
    await act(async () => (host.querySelector('[role="tab"]') as HTMLButtonElement).click());
    expect(host.querySelectorAll('.bingo__cell--hit')).toHaveLength(0);
  });

  it('covers what others predicted for a listener who has not heard the episode, never their own card', async () => {
    // A courtesy, not access control: this reads the position stored in *this* browser, so the same
    // person on another device is not covered, and one click reveals it anyway.
    await render(ctxWith(RESOLVED_BINGO, { user: fan }));

    expect(host.querySelector('.bingo__grid')).not.toBeNull();
    expect(host.textContent).not.toContain('Spoilers');

    await act(async () => (host.querySelector('[role="tab"]') as HTMLButtonElement).click());
    expect(host.textContent).toContain('Spoilers');
    expect(host.querySelector('.bingo__grid')).toBeNull();

    await act(async () => {
      (host.querySelector('.bingo__spoiler .bingo__btn--quiet') as HTMLButtonElement).click();
    });
    expect(host.querySelector('.bingo__grid')).not.toBeNull();
  });

  const CODE = 'GOP7-K2MQ-9XD4-HTFA';
  const HASH = 'b80087d0460bafadda33996223a80e9e44e963829286bdeb4701ce8d3cb845c0';
  /** Sealed by BingoImportTest for this code: card `Tyrion drinks` + an empty square, for episode `ep`. */
  const SEALED = { iv: 'AAAAAAAAAAAAAAAA', data: 'Q9gJMEAyl/xCGRT0i0joZW1lpCdjsNu6djjrgYRsx1ylG7qYCwB14HvIGw==', episodes: ['ep'] };

  it('copies a claimed card into the viewer’s partition and draws it, instead of offering a late card', async () => {
    const scopeEp = { type: 'episode' as const, id: 'ep' };
    const docs = makeMockDocs({
      'data/episode/ep/template': { size: 3 },
      'data/episode/ep/phase': { phase: 'RESOLVED', suggested: 'LOCKED', allowLate: true },
      'data/site/main/imports': { claimed: { [HASH]: { linked: 1, skipped: 0, episodes: ['ep'], sealed: SEALED } } },
      'data/user/me/claim': { codes: [CODE] },
    });
    const ctx = makeBingoCtx({ scope: scopeEp, docs, user: fan, progress: { get: async () => 3600 } });
    await act(async () => {
      root.render(<EpisodeBingo ctx={ctx} />);
    });
    for (let i = 0; i < 6; i++) {
      await flush(ctx);
      await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    }

    expect(docs.stored['data/user/me/card:ep']).toEqual({ entries: ['Tyrion drinks', ''], imported: true });
    expect((host.querySelector('.bingo__grid') as HTMLElement).textContent).toContain('Tyrion drinks');
    expect(host.textContent).not.toContain('Submit');
  }, 30_000);

  it('offers no late card to somebody the published board already lists', async () => {
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          [docPath('phase')]: { phase: 'LOCKED', suggested: 'LOCKED', allowLate: true },
          [docPath('leaderboard')]: {
            published: true, players: 1, rankBy: 'lines',
            ranked: [{ author: 'u1', fields: 3, lines: 1, cells: 9, ranked: true }], late: [],
          },
        },
        { user: fan },
      ),
    );

    expect(host.querySelector('textarea')).toBeNull();
    expect(host.textContent).toContain('is being linked');
  });

  it('does not blur a locked bingo that has nothing resolved yet', async () => {
    await render(
      ctxWith({
        [docPath('template')]: { size: 3 },
        [docPath('phase')]: { phase: 'LOCKED', suggested: 'LOCKED' },
        [docPath('showcased')]: { items: [{ userId: 'u2', entries: ['kraken'] }] },
      }),
    );

    expect(host.textContent).not.toContain('Spoilers');
  });

  it('offers no way in to an anonymous visitor, but still shows the cards', async () => {
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          [docPath('showcased')]: { items: [{ userId: 'u2', entries: ['kraken'] }] },
        },
        { users: makeMockUsers({ u2: 'Alice' }) },
      ),
    );

    expect(host.textContent).toContain('Sign in to fill in your own bingo.');
    expect(host.querySelector('textarea')).toBeNull();
    expect(host.textContent).toContain('Alice');
  });

  it('reads the whole episode in one fresh request, and only its own partition per key', async () => {
    // Every episode key can appear after the first visit — the template from another session, the rest
    // from the backend's tick — and `ctx.docs.get` remembers a miss for the life of the page. So the
    // episode goes through the uncached batch read, and `ctx.docs.get` is left the viewer's own partition,
    // which only this client ever writes.
    const docs = makeMockDocs({ [docPath('template')]: { size: 3 } });
    const ctx = makeBingoCtx({ scope, docs, user: fan });
    await render(ctx);

    expect(ctx.api.calls).toEqual([
      {
        method: 'get',
        path:
          `data/episode?ids=${EPISODE}&keys=template,phase,control,candidates,resolution,answers,` +
          'leaderboard,showcased,participants,showcase,grouping,recap',
      },
    ]);
    // Plus the site-wide suggestions, the one shared document a remembered miss cannot hurt.
    expect(
      docs.calls.filter((c) => c.method === 'get').flatMap((c) => c.partitions),
    ).toEqual(['data/user/me', 'data/user/me', 'data/site/main']);
  });

  it('lets a signed-in fan edit and save into their own partition', async () => {
    const docs = makeMockDocs({ [docPath('template')]: { size: 3 } });
    const ctx = makeBingoCtx({ scope, docs, user: fan });
    await render(ctx);

    const cell = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(cell).not.toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!;
      setter.call(cell, 'kraken');
      cell.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (host.querySelector('.bingo__btn') as HTMLButtonElement).click();
    });
    await flush(ctx);

    // Their own partition, never a per-user key under the episode scope — keys are client input.
    expect(docs.stored[`data/user/me/card:${EPISODE}`]).toBeDefined();
  });

  /** Types into the n-th square, as a person would. */
  const typeInto = async (index: number, value: string) => {
    const cell = host.querySelectorAll('textarea')[index] as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(cell, value);
      cell.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const saveButton = () =>
    [...host.querySelectorAll<HTMLButtonElement>('.bingo__actions .bingo__btn')].find((b) =>
      b.textContent?.includes('Save'),
    )!;

  it('refuses to save a square written twice, without asking the backend', async () => {
    const docs = makeMockDocs({ [docPath('template')]: { size: 3 } });
    const ctx = makeBingoCtx({ scope, docs, user: fan });
    await render(ctx);
    const before = ctx.api.calls.length;

    await typeInto(0, 'Kraken!');
    await typeInto(3, 'kraken');

    expect(host.textContent).toContain('Square 4 repeats square 1');
    expect(saveButton().disabled).toBe(true);
    expect(host.querySelectorAll('textarea')[3].getAttribute('aria-invalid')).toBe('true');
    expect(ctx.api.calls.length).toBe(before);

    await typeInto(3, 'merch plug');
    expect(saveButton().disabled).toBe(false);
  });

  it('warns about two squares that will most likely count as one, by the published threshold', async () => {
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          [docPath('phase')]: { phase: 'OPEN', suggested: 'OPEN', fuzzyThreshold: 0.8 },
        },
        { user: fan },
      ),
    );

    await typeInto(0, 'kraken');
    await typeInto(1, 'krakken');

    expect(host.textContent).toContain('Square 2 is very close to square 1');
    expect(saveButton().disabled).toBe(false);
  });

  it('offers the site vocabulary as entry suggestions, and fills the next empty square', async () => {
    const docs = makeMockDocs({ [docPath('template')]: { size: 3 } });
    const ctx = makeBingoCtx({
      scope,
      docs,
      user: fan,
      tags: makeMockTags().withFeedTag('kraken-ep', 'maritime'),
    });
    await render(ctx);

    const chip = host.querySelector('.bingo__chip') as HTMLButtonElement;
    expect(chip).not.toBeNull();
    await act(async () => chip.click());

    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(chip.textContent);
  });

  const SUGGESTIONS = {
    items: [
      { label: 'Kraken!', people: 5, episodes: 3, hits: 2 },
      { label: 'merch plug', people: 2, episodes: 1, hits: 0 },
    ],
  };

  it('offers what several people keep predicting, and nothing already on the card', async () => {
    const docs = makeMockDocs({
      [docPath('template')]: { size: 3 },
      'data/site/main/suggestions': SUGGESTIONS,
    });
    const ctx = makeBingoCtx({ scope, docs, user: fan });
    await render(ctx);

    const chips = () => [...host.querySelectorAll<HTMLButtonElement>('.bingo__chip')].map((c) => c.textContent);
    expect(chips()).toEqual(['Kraken!', 'merch plug']);

    await typeInto(4, 'kraken');
    expect(chips()).toEqual(['merch plug']);

    await act(async () => host.querySelectorAll('textarea')[2].dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    await act(async () => (host.querySelector('.bingo__chip') as HTMLButtonElement).click());
    expect((host.querySelectorAll('textarea')[2] as HTMLTextAreaElement).value).toBe('merch plug');
  });

  it('remembers turning suggestions off, at once and in the player’s own partition', async () => {
    const docs = makeMockDocs({
      [docPath('template')]: { size: 3 },
      'data/site/main/suggestions': SUGGESTIONS,
      'data/user/me/prefs': { listed: false },
    });
    const ctx = makeBingoCtx({ scope, docs, user: fan });
    await render(ctx);

    const toggle = [...host.querySelectorAll<HTMLInputElement>('.bingo__suggestions input')][0];
    await act(async () => toggle.click());
    await flush(ctx);

    expect(host.querySelector('.bingo__chip')).toBeNull();
    // The stored choices ride along untouched; nothing unsaved is written behind the player's back.
    expect(docs.stored['data/user/me/prefs']).toMatchObject({ listed: false, suggestions: false });
  });

  it('starts with suggestions hidden for someone who turned them off', async () => {
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          'data/site/main/suggestions': SUGGESTIONS,
          'data/user/me/prefs': { suggestions: false },
        },
        { user: fan },
      ),
    );

    expect(host.querySelector('.bingo__chip')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('.bingo__suggestions input')?.checked).toBe(false);
  });

  it('renders no suggestions when the host offers no tag surface', async () => {
    // `ctx.tags` is null unless the manifest declares a tags block, and is null in the mock by default.
    await render(
      ctxWith({ [docPath('template')]: { size: 3 } }, { user: fan }),
    );

    expect(host.querySelector('.bingo__chip')).toBeNull();
  });

  it('warns a latecomer that their card will not be ranked', async () => {
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          [docPath('phase')]: { phase: 'LOCKED', suggested: 'LOCKED' },
        },
        { user: fan },
      ),
    );

    expect(host.textContent).toContain('will not count towards the leaderboard');
  });

  it('stops offering an edit once the card is frozen', async () => {
    // The backend never re-reads a card that already has rows, so an edit here would be a control that
    // does nothing — the same dead control the lock button used to be.
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          [docPath('phase')]: { phase: 'LOCKED', suggested: 'LOCKED', allowLate: true },
          'data/user/me/card:ep-1': { entries: ['kraken'] },
        },
        { user: fan },
      ),
    );

    expect(host.querySelector('textarea')).toBeNull();
    expect(host.textContent).toContain('Your card is frozen');
  });

  it('lets a latecomer hand a card in exactly once, and says it is final', async () => {
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          [docPath('phase')]: { phase: 'LOCKED', suggested: 'LOCKED', allowLate: true },
        },
        { user: fan },
      ),
    );

    expect(host.querySelector('textarea')).not.toBeNull();
    expect(host.textContent).toContain('Hand in my bingo');
    expect(host.textContent).toContain('cannot be changed afterwards');
  });

  it('offers no card at all to a latecomer when late entries are off', async () => {
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          [docPath('phase')]: { phase: 'LOCKED', suggested: 'LOCKED', allowLate: false },
        },
        { user: fan },
      ),
    );

    expect(host.querySelector('textarea')).toBeNull();
  });

  it('still lets a frozen player change how they appear', async () => {
    // The visibility switches are a standing choice about the person, not part of the card.
    const docs = makeMockDocs({
      [docPath('template')]: { size: 3 },
      [docPath('phase')]: { phase: 'RESOLVED', suggested: 'LOCKED', allowLate: true },
      'data/user/me/card:ep-1': { entries: ['kraken'] },
      'data/user/me/prefs': { listed: true, showcasable: true },
    });
    const ctx = makeBingoCtx({ scope, docs, user: fan, progress: { get: async () => 3600 } });
    await render(ctx);

    const listed = host.querySelectorAll<HTMLInputElement>('.bingo__check input')[0];
    await act(async () => {
      listed.click();
    });
    await act(async () => {
      (host.querySelector('.bingo__btn') as HTMLButtonElement).click();
    });
    await flush(ctx);

    expect(docs.stored['data/user/me/prefs']).toMatchObject({ listed: false });
    // …and the frozen card is untouched by that save.
    expect(docs.stored['data/user/me/card:ep-1']).toEqual({ entries: ['kraken'] });
  });

  it('refuses editing outright once the bingo is archived', async () => {
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          [docPath('phase')]: { phase: 'ARCHIVED', suggested: 'LOCKED' },
        },
        { user: fan },
      ),
    );

    expect(host.querySelector('textarea')).toBeNull();
    expect(host.textContent).toContain('closed for good');
  });

  const BOARD = {
    [docPath('template')]: { size: 3 },
    [docPath('phase')]: { phase: 'RESOLVED', suggested: 'LOCKED' },
    [docPath('leaderboard')]: {
      published: true,
      players: 2,
      distribution: [
        { lines: 1, fields: 6, count: 1 },
        { lines: 0, fields: 7, count: 1 },
      ],
      ranked: [{ author: 'u2', fields: 6, lines: 1, cells: 9, ranked: true }],
      late: [{ author: 'u3', fields: 7, lines: 0, cells: 9, ranked: false }],
    },
  };

  it('separates the ranked board from people who played late', async () => {
    await render(ctxWith(BOARD, heardIt));

    expect(host.textContent).toContain('Leaderboard');
    expect(host.textContent).toContain('Played late');
  });

  it('draws a fan from the host directory rather than from anything it stored', async () => {
    // The row carries only a UUID. A display name copied into plugin storage would outlive the rename
    // meant to shed it and the erasure meant to end it.
    await render(
      ctxWith(BOARD, {
        ...heardIt,
        users: makeMockUsers({ u2: 'Alice', u3: 'Bob' }),
      }),
    );

    expect(host.textContent).toContain('Alice');
    expect(host.textContent).toContain('Bob');
    const avatars = [...host.querySelectorAll('img.bingo__avatar')].map((i) => i.getAttribute('src'));
    expect(avatars).toContain('/api/users/u2/avatar');
  });

  it('keeps a row whose author can no longer be resolved', async () => {
    // An erased or pseudonymised id is absent from resolve(), not an error — and the aggregate must stay
    // true even though the person is gone.
    await render(ctxWith(BOARD, { ...heardIt, users: makeMockUsers({ u2: 'Alice' }) }));

    expect(host.textContent).toContain('Alice');
    expect(host.textContent).toContain('Former listener');
    expect(host.textContent).toContain('7/9 fields');
  });

  it('marks the viewer’s own row', async () => {
    await render(
      ctxWith(BOARD, {
        ...heardIt,
        users: makeMockUsers({ u2: 'Alice', u3: 'Bob' }),
        user: { id: 'u2', role: 'fan', displayName: 'Alice', avatarUrl: '/api/users/u2/avatar' },
      }),
    );

    const mine = [...host.querySelectorAll('.bingo__row')].find((r) => r.textContent?.includes('Alice'));
    expect(mine?.querySelector('.bingo__role')?.textContent).toBe('You');
    const theirs = [...host.querySelectorAll('.bingo__row')].find((r) => r.textContent?.includes('Bob'));
    expect(theirs?.querySelector('.bingo__role')).toBeNull();
  });

  it('prefills the visibility toggles from what was saved last time, and writes both', async () => {
    const docs = makeMockDocs({
      [docPath('template')]: { size: 3 },
      'data/user/me/prefs': { listed: false, showcasable: true },
    });
    const ctx = makeBingoCtx({ scope, docs, user: fan });
    await render(ctx);

    const boxes = [...host.querySelectorAll<HTMLInputElement>('.bingo__check input')];
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);

    await act(async () => {
      (host.querySelector('.bingo__btn') as HTMLButtonElement).click();
    });
    await flush(ctx);
    expect(docs.stored['data/user/me/prefs']).toMatchObject({ listed: false, showcasable: true });
    expect(docs.stored[`data/user/me/card:${EPISODE}`]).toBeDefined();
  });

  it('tells someone who opted out why they are not on the board', async () => {
    await render(
      ctxWith(
        { ...BOARD, 'data/user/me/prefs': { listed: false } },
        { ...heardIt, user: fan, users: makeMockUsers({ u2: 'Alice' }) },
      ),
    );

    expect(host.textContent).toContain('not on the public leaderboard');
  });

  it('still places someone who opted out, on their own screen', async () => {
    // They have no published row by definition, which makes them exactly the reader the tally exists for.
    // The row is drawn from their own card in their own browser, so nobody else learns anything from it.
    await render(
      ctxWith(
        {
          ...BOARD,
          [docPath('resolution')]: { hits: { kraken: true } },
          'data/user/me/prefs': { listed: false },
          [`data/user/me/card:${EPISODE}`]: { entries: ['kraken', '', '', '', '', '', '', '', ''] },
        },
        { ...heardIt, user: fan, users: makeMockUsers({ u2: 'Alice' }) },
      ),
    );

    expect(host.textContent).toContain('not on the public leaderboard');
    const mine = [...host.querySelectorAll('.bingo__row')].find((r) =>
      r.querySelector('.bingo__role'),
    );
    expect(mine, 'their own row is drawn even though the board never published it').toBeDefined();
    // The directory was never asked about them — their id is on no published row — but `ctx.user` says.
    expect(mine?.textContent).toContain('Ned');
    expect(mine?.textContent).not.toContain('Former listener');
  });

  it('does not place a reader who never handed a card in', async () => {
    // Found on a live host: a podcaster who resolved without playing was drawn in last place, as a
    // "Former listener" scoring the free middle square — an all-blank draft is not a card.
    await render(
      ctxWith(
        {
          ...BOARD,
          [docPath('template')]: { size: 3, freeCentre: true },
          [docPath('resolution')]: { hits: { kraken: true } },
        },
        { ...heardIt, user: fan, users: makeMockUsers({ u2: 'Alice' }) },
      ),
    );

    expect(host.querySelector('.bingo__rows')).not.toBeNull();
    expect(host.querySelector('.bingo__role'), 'no row is theirs').toBeNull();
  });

  it('still renders the board when the host offers no identity surface', async () => {
    // `ctx.users` is null unless the manifest declares an identity block, and null in the mock by default.
    await render(ctxWith(BOARD, heardIt));

    expect(host.textContent).toContain('Former listener');
    expect(host.textContent).toContain('6/9 fields');
  });

  const RECAP = {
    published: true, players: 3, ranked: 3, avgFields: 2.33, withLine: 0.333,
    mostPredicted: { label: 'kraken', cards: 3, hit: true },
    rarestHit: { label: 'guest is late', cards: 1, hit: true },
    biggestMiss: { label: 'merch plug', cards: 2, hit: false },
  };

  it('tells what happened once it is resolved', async () => {
    await render(
      ctxWith({
        [docPath('template')]: { size: 3 },
        [docPath('phase')]: { phase: 'RESOLVED', suggested: 'LOCKED' },
        [docPath('recap')]: RECAP,
      }),
    );

    expect(host.textContent).toContain('Most predicted: “kraken”, on 3 card(s) · it happened');
    expect(host.textContent).toContain('Rarest hit: “guest is late”');
    expect(host.textContent).toContain('Biggest miss: “merch plug”');
    expect(host.textContent).toContain('33% got at least one line');
  });

  it('keeps the recap behind the spoiler cover', async () => {
    const ctx = makeBingoCtx({
      scope,
      docs: makeMockDocs({
        [docPath('template')]: { size: 3 },
        [docPath('phase')]: { phase: 'RESOLVED', suggested: 'LOCKED' },
        [docPath('resolution')]: { hits: { kraken: true } },
        [docPath('recap')]: RECAP,
      }),
    });
    ctx.progress.get = async () => null; // never listened on this device
    await render(ctx);

    expect(host.textContent).not.toContain('Most predicted');
  });

  it('shares a player’s own result once the published board carries it, the bingo otherwise', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    const board = {
      published: true, players: 1, totalPlayers: 1, rankBy: 'lines',
      ranked: [{ author: 'u1', fields: 2, lines: 0, cells: 9, ranked: true }], late: [],
    };
    const docs = makeMockDocs({
      [docPath('template')]: { size: 3 },
      [docPath('phase')]: { phase: 'RESOLVED', suggested: 'LOCKED' },
      [docPath('leaderboard')]: board,
      [`data/user/me/card:${EPISODE}`]: { entries: ['kraken'] },
    });
    await render(makeBingoCtx({ scope, docs, user: fan }));
    const share = () =>
      [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Share')!;

    await act(async () => share().click());
    expect(written.at(-1)).toBe(`${window.location.origin}/p/bingo/e/${EPISODE}/u/u1`);
    expect(host.textContent).toContain('Link copied');

    act(() => root.unmount());
    root = createRoot(host);
    await render(makeBingoCtx({ scope, docs, user: { ...fan, id: 'u9' } }));
    await act(async () => share().click());
    expect(written.at(-1)).toBe(`${window.location.origin}/p/bingo/e/${EPISODE}`);
  });

  it('shows no results at all until the bingo is resolved', async () => {
    // The backend does not publish rows before then either; this is the second lock on the same door.
    await render(
      ctxWith({
        [docPath('template')]: { size: 3 },
        [docPath('leaderboard')]: { published: false, players: 4, ranked: [], late: [] },
      }),
    );

    expect(host.textContent).toContain('4 card(s) so far');
    expect(host.querySelector('.bingo__rows')).toBeNull();
  });

  it('places a reader who is past the published cap', async () => {
    // The board carries 50 rows at most, so somebody in 73rd place is in none of them. Their own score
    // plus how many did better still places them exactly, and the tally names nobody.
    const top = Array.from({ length: 5 }, (_, i) => ({
      author: `p${i}`, fields: 9, lines: 4, cells: 9, ranked: true,
    }));
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          [docPath('candidates')]: { items: [], assignments: { mine: 'mine' } },
          [docPath('resolution')]: { hits: { mine: true } },
          'data/user/me/card:ep-1': { entries: ['mine', '', '', '', '', '', '', '', ''] },
          [docPath('leaderboard')]: {
            published: true,
            players: 73,
            ranked: top,
            late: [],
            // 72 people did better than one field and no lines.
            distribution: [{ lines: 4, fields: 9, count: 72 }, { lines: 0, fields: 1, count: 1 }],
          },
        },
        { ...heardIt, user: fan, users: makeMockUsers(Object.fromEntries(top.map((r) => [r.author, r.author]))) },
      ),
    );

    const places = [...host.querySelectorAll('.bingo__place')].map((p) => p.textContent);
    expect(places).toEqual(['1', '2', '3', '4', '5', '73']);
  });

  it('folds a long board to the first few places and keeps your own', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      author: `p${i}`, fields: 9 - i, lines: 0, cells: 9, ranked: true,
    }));
    await render(
      ctxWith(
        {
          [docPath('template')]: { size: 3 },
          [docPath('leaderboard')]: { published: true, players: 9, ranked: many, late: [] },
        },
        {
          ...heardIt,
          user: { id: 'p7', role: 'fan', displayName: 'Late', avatarUrl: '/api/users/p7/avatar' },
          users: makeMockUsers(Object.fromEntries(many.map((r, i) => [r.author, `Player ${i}`]))),
        },
      ),
    );

    const rows = [...host.querySelectorAll('.bingo__row')];
    expect(rows).toHaveLength(6); // the top five, plus the reader wherever they actually are
    expect(rows[5].textContent).toContain('Player 7');
    expect(rows[5].querySelector('.bingo__place')?.textContent).toBe('8');
    expect(host.textContent).toContain('and 3 more');
  });
});
