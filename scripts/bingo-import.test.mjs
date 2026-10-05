// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

// node --test scripts/*.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensurePlayers, fillable, hashOf, importDoc, matchEpisode, newCode, parse, validate } from './bingo-import.mjs';

const square = (text, hit = false) => ({ text, hit });
const nine = (first) => [square(first, true), ...Array.from({ length: 8 }, (_, i) => square(`filler ${i}`))];
const file = (bingos, players) => ({ format: 'mosaicast-bingo/1', bingos, ...(players ? { players } : {}) });
const bingo = (extra = {}) => ({
  episode: { season: 1, episode: 2 }, size: 3, freeCentre: false,
  cards: [{ player: 'max', squares: nine('Tyrion drinks') }], ...extra,
});

test('the grid is stated, and the squares must fit it', () => {
  assert.equal(fillable(3, false), 9);
  assert.equal(fillable(3, true), 8);
  assert.equal(fillable(5, true), 24);
  assert.deepEqual(validate(file([bingo()])), []);
  const problems = validate(file([bingo({ freeCentre: true }), bingo({ size: 4, freeCentre: true }), bingo({ freeCentre: undefined })]));
  assert.match(problems[0].problem, /9 entries, a 3x3 with a free centre needs 8/);
  assert.match(problems.find((p) => p.at === 'bingos[1].freeCentre').problem, /no single middle square/);
  assert.match(problems.find((p) => p.at === 'bingos[2].freeCentre').problem, /must be stated/);
});

test('every problem is reported with where it is, not just the first', () => {
  const problems = validate(file([
    bingo({ episode: {} }),
    bingo({ cards: [{ player: 'max', squares: nine('a') }, { player: 'max', squares: [square('a', false), ...nine('x').slice(1)] }] }),
    bingo({ cards: [{ player: 'ghost', squares: nine('a') }] }),
  ], { max: { name: 'Max' } }));
  const at = problems.map((p) => p.at);
  assert.ok(at.includes('bingos[0].episode'));
  assert.ok(at.includes('bingos[1].cards[1].player'), 'two cards for one player');
  assert.ok(problems.some((p) => /marked false here and true/.test(p.problem)), 'one truth per spelling');
  assert.ok(at.includes('bingos[2].cards[0].player'), 'unknown player key');
});

test('broken JSON and a wrong format stop everything', () => {
  assert.match(parse('{nope').fatal, /not JSON/);
  assert.match(parse('{"format":"other"}').fatal, /mosaicast-bingo\/1/);
  assert.ok(parse(JSON.stringify(file([]))).file);
});

test('episodes are matched by slug or by numbers, and ambiguity says so', () => {
  const episodes = [
    { slug: 'gop-s1e2', season: 1, episodeNo: 2 },
    { slug: 'other-s1e2', season: 1, episodeNo: 2 },
    { slug: 'gop-s1e3', season: 1, episodeNo: 3 },
  ];
  assert.deepEqual(matchEpisode({ slug: 'gop-s1e3' }, episodes), { slug: 'gop-s1e3' });
  assert.deepEqual(matchEpisode({ season: 1, episode: 3 }, episodes), { slug: 'gop-s1e3' });
  assert.match(matchEpisode({ season: 1, episode: 2 }, episodes).problem, /2 feeds; give its slug/);
  assert.match(matchEpisode({ season: 9, episode: 9 }, episodes).problem, /no episode S9E9/);
});

test('codes are long, readable, and hashed the way the backend hashes them', () => {
  const code = newCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  assert.equal(hashOf('gop7 k2mq-9xd4 htfa'), hashOf('GOP7-K2MQ-9XD4-HTFA'));
  // BingoImportTest asserts the same value in Java: both halves must agree, or no code would ever match.
  assert.equal(hashOf('GOP7-K2MQ-9XD4-HTFA'), 'b80087d0460bafadda33996223a80e9e44e963829286bdeb4701ce8d3cb845c0');
});

test('players get a pseudonym and a code once, and only claims for their own bingo are sent', () => {
  const state = { players: {} };
  assert.deepEqual(ensurePlayers(state, ['max', 'alex']), ['max', 'alex']);
  assert.deepEqual(ensurePlayers(state, ['max']), [], 'a re-run reuses them');
  const doc = importDoc(bingo({ title: 'S1E2' }), 'gop-s1e2', state, 'skip');
  assert.equal(doc.cards[0].author, state.players.max.pseudonym);
  assert.equal(doc.cards[0].ranked, true);
  assert.deepEqual(Object.values(doc.claims), [state.players.max.pseudonym], 'alex has no card here');
  assert.ok(!JSON.stringify(doc).includes('Max'), 'no name ever leaves the file');
});
