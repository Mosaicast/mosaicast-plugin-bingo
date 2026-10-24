// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  actionRejection,
  makeMockActions,
  makeMockChannels,
  makeMockDocs,
  makeMockFeeds,
  makeMockUsers,
  type MockActionHandler,
} from '@mosaicast/plugin-sdk/testing';
import { BingoPage } from './BingoPage';
import { flush, makeBingoCtx } from '../test-utils';
import type { DraftView } from '../types';

const site = { type: 'site' as const, id: 'main' };
const me = { id: 'b', displayName: 'Bea', avatarUrl: '/api/users/b/avatar', role: 'fan' as const };

function view(overrides: Partial<DraftView> = {}): DraftView {
  return {
    id: 'r1',
    version: 1,
    now: Date.now(),
    status: 'RUNNING',
    episode: 'ep-1',
    host: 'a',
    size: 2,
    freeCentre: false,
    threshold: 0.85,
    settings: { clock: false, turnSeconds: null, bankSeconds: null, incrementSeconds: 0, duplicateCheck: true },
    invited: [],
    order: ['a', 'b'],
    createdAt: 0,
    online: ['a', 'b'],
    game: {
      stage: 'REGULAR',
      overtime: 0,
      current: 'b',
      turnStartedAt: Date.now(),
      usedMs: 0,
      turnLimitMs: null,
      deadline: null,
      seats: [
        { userId: 'a', bankMs: null, out: false, done: false, skipped: 0, filled: 1, cells: ['Rain', '', '', ''] },
        { userId: 'b', bankMs: null, out: false, done: false, skipped: 0, filled: 0, cells: ['', '', '', ''] },
      ],
    },
    ...overrides,
  };
}

describe('<BingoPage> draft round', () => {
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

  async function render(path: string, handlers: Record<string, MockActionHandler>, user = me) {
    const actions = makeMockActions(handlers);
    const channels = makeMockChannels();
    const ctx = makeBingoCtx({
      scope: site,
      docs: makeMockDocs({}),
      feeds: makeMockFeeds().withDisplay('ep-1', { title: 'The Kraken', description: '' }),
      users: makeMockUsers({ a: 'Ann', b: 'Bea' }),
      route: { path },
      user,
      actions,
      channels,
    });
    await act(async () => {
      root.render(<BingoPage ctx={ctx} />);
    });
    await flush(ctx);
    await flush(ctx);
    return { ctx, actions, channels };
  }

  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

  it('subscribes to the round, then fetches it', async () => {
    const { actions, channels } = await render('draft/r1', { 'draft-state': () => view() });
    expect(channels.subscriptions.map((s) => s.name)).toEqual(['draft:r1']);
    expect(actions.calls.map((c) => c.name)).toEqual(['draft-state']);
    expect(host.textContent).toContain('For “The Kraken”');
    expect(host.textContent).toContain('Your turn');
  });

  it('applies the next update in place and fetches again when one went missing', async () => {
    const { actions, channels } = await render('draft/r1', { 'draft-state': () => view() });
    const { online: _o, ...shared } = view({ version: 2 });
    act(() => {
      channels.emit('draft:r1', 'update', {
        ...shared,
        game: { ...shared.game, seats: shared.game!.seats.map(({ cells: _c, ...s }) => s) },
        written: { userId: 'a', cell: 1, text: 'Thunder' },
      });
    });
    await flush();
    expect(host.textContent).toContain('Thunder');
    expect(actions.calls).toHaveLength(1);

    act(() => {
      channels.emit('draft:r1', 'update', { ...shared, version: 9 });
    });
    await flush();
    expect(actions.calls.map((c) => c.name)).toEqual(['draft-state', 'draft-state']);
  });

  it('fetches again when the host cannot replay', async () => {
    const { actions, channels } = await render('draft/r1', { 'draft-state': () => view() });
    act(() => channels.reset('draft:r1'));
    await flush();
    expect(actions.calls).toHaveLength(2);
  });

  it('places a square on the player\'s turn and says why one was refused', async () => {
    const { actions } = await render('draft/r1', {
      'draft-state': () => view(),
      'draft-move': () => actionRejection('cell-taken'),
    });
    const square = host.querySelector<HTMLButtonElement>('button[aria-label="Square 2"]')!;
    act(() => square.click());
    const input = host.querySelector<HTMLInputElement>('.bingo__draft-entry input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Sun');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Place it')!.click());
    await flush();
    expect(actions.calls.at(-1)).toMatchObject({ name: 'draft-move', payload: { id: 'r1', cell: 1, text: 'Sun' } });
    expect(host.textContent).toContain('That square is already filled.');
  });

  it('warns before a square that repeats the player\'s own', async () => {
    const mine = view();
    mine.game!.seats[1].cells = ['Rain', '', '', ''];
    await render('draft/r1', { 'draft-state': () => mine });
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Square 2"]')!.click());
    const input = host.querySelector<HTMLInputElement>('.bingo__draft-entry input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'rain!');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('You already have that on your card.');
    expect(button('Place it')!.disabled).toBe(true);
  });

  it('asks a voter, and only a voter, to decide on a close square', async () => {
    const voting = view({
      game: {
        ...view().game!,
        current: 'a',
        deadline: Date.now() + 30_000,
        vote: {
          by: 'a', cell: 1, text: 'rain!', matches: [{ userId: 'b', cell: 0, text: 'Rain' }],
          voters: ['b'], voted: [], deadline: Date.now() + 30_000, awaitingHost: false,
        },
      },
    });
    const { actions } = await render('draft/r1', { 'draft-state': () => voting, 'draft-vote': () => voting });
    expect(host.textContent).toContain('Ann wrote “rain!”');
    await act(async () => button('Turn it down')!.click());
    expect(actions.calls.at(-1)).toMatchObject({ name: 'draft-vote', payload: { allow: false } });
  });

  it('lets the host reorder the lobby', async () => {
    const lobby = view({ status: 'LOBBY', game: undefined, code: 'c0de', order: ['a', 'b'] });
    const { actions } = await render(
      'draft/r1',
      { 'draft-state': () => lobby, 'draft-setup': () => lobby },
      { ...me, id: 'a', displayName: 'Ann', role: 'podcaster' as never },
    );
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Move Bea up"]')!.click());
    expect(actions.calls.at(-1)).toMatchObject({ name: 'draft-setup', payload: { order: ['b', 'a'] } });
    expect(host.querySelector<HTMLInputElement>('.bingo__code')!.value).toContain('/p/bingo/draft/r1?code=c0de');
  });

  it('tells somebody outside the round that it isn\'t theirs', async () => {
    await render('draft/r1', { 'draft-state': () => actionRejection('not-invited') });
    expect(host.textContent).toContain('You\'re not in this round.');
  });

  it('shows a fan no draft box on the bingo page until they have a round', async () => {
    await render('', { 'draft-inbox': () => ({ items: [] }) });
    expect(host.textContent).not.toContain('Your draft rounds');
  });

  it('shows the box once there is a round, and an invite arrives live', async () => {
    let items: unknown[] = [];
    const { channels } = await render('', { 'draft-inbox': () => ({ items }) });
    items = [{ id: 'r1', status: 'LOBBY', host: 'a', role: 'invited', players: 1, yourTurn: false, createdAt: 1, episode: 'ep-1' }];
    act(() => channels.emit('inbox', 'invited', { id: 'r1' }));
    await flush();
    await flush();
    expect(host.textContent).toContain('Your draft rounds');
    expect(host.textContent).toContain('Invited by Ann');
    const open = [...host.querySelectorAll('a')].find((l) => l.textContent === 'See invite');
    expect(open?.getAttribute('href')).toBe('/p/bingo/draft/r1');
  });

  it('gives every round a button that says what to do there', async () => {
    await render('draft', {
      'draft-inbox': () => ({
        items: [
          { id: 'r1', status: 'RUNNING', host: 'a', role: 'player', players: 2, yourTurn: true, createdAt: 2, episode: 'ep-1' },
          { id: 'r2', status: 'FINISHED', host: 'b', role: 'host', players: 2, yourTurn: false, createdAt: 1, episode: 'ep-1' },
        ],
      }),
    });
    const buttons = [...host.querySelectorAll('a.bingo__btn')].map((l) => [l.textContent, l.getAttribute('href')]);
    expect(buttons).toEqual([
      ['Take your turn', '/p/bingo/draft/r1'],
      ['Open the round', '/p/bingo/draft/r2'],
    ]);
  });
});
