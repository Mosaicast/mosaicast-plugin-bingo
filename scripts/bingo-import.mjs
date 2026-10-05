#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * Imports bingos played before a site ran Mosaicast, from a `mosaicast-bingo/1` file.
 *
 *   node scripts/bingo-import.mjs --file past.json --url "$MC_APP_URL"            # dry run: report only
 *   node scripts/bingo-import.mjs --file past.json --url "$MC_APP_URL" --apply    # write, then wait for the result
 *   node scripts/bingo-import.mjs unclaim --file past.json --player max --url "$MC_APP_URL"
 *
 * The token is a podcaster's personal access token in MC_TOKEN (Authorization: Bearer).
 *
 * The script only checks, matches and hands over: the plugin's backend takes every bingo in on its next
 * pass and validates again, and writes the outcome to the `imports` report this script then prints. Players
 * never get attached to an account here. Each player key in the file gets a pseudonym and a claim code,
 * kept in `<file>.players.json` next to the input (secret: it holds the codes); whoever enters a code on the
 * bingo page becomes that player. See docs/import-format.md.
 *
 * No dependencies; Node 18 or newer.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FORMAT = 'mosaicast-bingo/1';
const PLUGIN = 'bingo';
/** Letters and digits that cannot be misread for one another: no I, O, 0 or 1. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------------------------------------------------------------- pure parts (tested in bingo-import.test.mjs)

/** How many squares a card has: the free centre is stated by the grid, not written. */
export function fillable(size, freeCentre) {
  return size * size - (freeCentre ? 1 : 0);
}

/**
 * Every problem in a file, with where it is. Empty when the file is fine.
 *
 * Mirrors what the backend refuses, so a dry run shows it all at once; the backend checks again anyway.
 * Broken JSON and a wrong format are reported by {@link parse}, before any of this.
 */
export function validate(file) {
  const problems = [];
  const bingos = Array.isArray(file.bingos) ? file.bingos : null;
  if (!bingos) return [{ at: 'bingos', problem: 'missing or not a list' }];
  const players = file.players && typeof file.players === 'object' ? file.players : null;

  bingos.forEach((bingo, b) => {
    const at = `bingos[${b}]`;
    const add = (where, problem) => problems.push({ at: `${at}${where}`, bingo: b, problem });
    const episode = bingo?.episode ?? {};
    if (!episode.slug && !(Number.isInteger(episode.season) && Number.isInteger(episode.episode))) {
      add('.episode', 'needs a slug, or a season and an episode number');
    }
    if (![3, 4, 5].includes(bingo?.size)) add('.size', 'must be 3, 4 or 5');
    if (typeof bingo?.freeCentre !== 'boolean') add('.freeCentre', 'must be stated: true or false');
    else if (bingo.freeCentre && bingo.size % 2 === 0) {
      add('.freeCentre', `a ${bingo.size}x${bingo.size} grid has no single middle square`);
    }
    if (bingo?.onExisting !== undefined && !['skip', 'merge'].includes(bingo.onExisting)) {
      add('.onExisting', 'must be "skip" or "merge"');
    }
    const cards = Array.isArray(bingo?.cards) ? bingo.cards : [];
    if (cards.length === 0) add('.cards', 'no cards');
    const need = [3, 4, 5].includes(bingo?.size) && typeof bingo?.freeCentre === 'boolean'
      ? fillable(bingo.size, bingo.freeCentre) : null;
    const seen = new Set();
    const judged = new Map();
    cards.forEach((card, c) => {
      const where = `.cards[${c}]`;
      if (typeof card?.player !== 'string' || !card.player.trim()) add(`${where}.player`, 'missing');
      else {
        if (seen.has(card.player)) add(`${where}.player`, `"${card.player}" has two cards in this bingo`);
        seen.add(card.player);
        if (players && !(card.player in players)) add(`${where}.player`, `"${card.player}" is not in players`);
      }
      if (card?.ranked !== undefined && typeof card.ranked !== 'boolean') add(`${where}.ranked`, 'must be true or false');
      const squares = Array.isArray(card?.squares) ? card.squares : null;
      if (!squares) return add(`${where}.squares`, 'missing');
      if (need !== null && squares.length !== need) {
        add(`${where}.squares`, `${squares.length} entries, a ${bingo.size}x${bingo.size}${bingo.freeCentre ? ' with a free centre' : ''} needs ${need}`);
      }
      let filled = 0;
      squares.forEach((square, s) => {
        if (typeof square?.text !== 'string') return add(`${where}.squares[${s}].text`, 'must be text ("" for an empty square)');
        if (square.hit !== undefined && typeof square.hit !== 'boolean') add(`${where}.squares[${s}].hit`, 'must be true or false');
        const key = square.text.trim().toLowerCase();
        if (!key) return;
        filled++;
        const hit = square.hit === true;
        if (judged.has(key) && judged.get(key) !== hit) {
          add(`${where}.squares[${s}]`, `"${square.text}" is marked ${hit} here and ${!hit} on another card`);
        }
        judged.set(key, hit);
      });
      if (squares.length > 0 && filled === 0) add(where, 'every square is empty');
    });
  });
  return problems;
}

/** The file, or why it cannot be read at all — the two problems that stop everything. */
export function parse(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch (error) {
    return { fatal: `not JSON: ${error.message}` };
  }
  if (file?.format !== FORMAT) return { fatal: `format must be "${FORMAT}", got ${JSON.stringify(file?.format)}` };
  return { file };
}

/**
 * Finds each bingo's episode among the site's episodes (`GET /api/episodes`): by slug, or by season and
 * episode number. Two feeds with the same numbers make that ambiguous — the answer is the slug.
 */
export function matchEpisode(episode, episodes) {
  if (episode?.slug) {
    return episodes.some((e) => e.slug === episode.slug)
      ? { slug: episode.slug } : { problem: `no episode with slug ${episode.slug}` };
  }
  const found = episodes.filter((e) => e.season === episode?.season && e.episodeNo === episode?.episode);
  if (found.length === 1) return { slug: found[0].slug };
  if (found.length === 0) return { problem: `no episode S${episode?.season}E${episode?.episode}` };
  return { problem: `S${episode.season}E${episode.episode} is in ${found.length} feeds; give its slug` };
}

/** A fresh claim code: 16 characters, 80 bits, printed in groups of four. */
export function newCode() {
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return chars.match(/.{4}/g).join('-');
}

/** What a code is known by on the server: SHA-256 of its letters and digits, upper-cased (BingoImport.hashOf). */
export function hashOf(code) {
  return createHash('sha256').update(code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()).digest('hex');
}

/** Adds a pseudonym and a code for every player key the state does not know yet. Returns the new keys. */
export function ensurePlayers(state, keys) {
  const added = [];
  for (const key of keys) {
    if (!state.players[key]) {
      state.players[key] = { pseudonym: `import:${randomUUID()}`, code: newCode() };
      added.push(key);
    }
  }
  return added;
}

/** The document the backend takes in for one bingo. */
export function importDoc(bingo, slug, state, onExisting) {
  const cards = bingo.cards.map((card) => ({
    author: state.players[card.player].pseudonym,
    ranked: card.ranked !== false,
    squares: card.squares.map((s) => ({ text: s.text, hit: s.hit === true })),
  }));
  const claims = Object.fromEntries(
    [...new Set(bingo.cards.map((c) => c.player))].map((key) => [hashOf(state.players[key].code), state.players[key].pseudonym]),
  );
  return {
    slug,
    title: bingo.title ?? '',
    size: bingo.size,
    freeCentre: bingo.freeCentre,
    onExisting: bingo.onExisting ?? onExisting,
    cards,
    claims,
  };
}

// ---------------------------------------------------------------- talking to the site

function client(url, token) {
  const base = url.replace(/\/+$/, '');
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  return {
    get: (path) => call('GET', path),
    put: (path, body) => call('PUT', path, body),
  };
}

async function allEpisodes(api) {
  const out = [];
  for (let page = 0; ; page++) {
    const answer = await api.get(`/api/episodes?page=${page}&size=100`);
    out.push(...(answer?.items ?? []));
    if (!answer || page + 1 >= answer.totalPages) return out;
  }
}

/** Which of these episodes already have a bingo, and in which phase. */
async function existingBingos(api, slugs) {
  const out = {};
  for (let i = 0; i < slugs.length; i += 100) {
    const ids = slugs.slice(i, i + 100).map(encodeURIComponent).join(',');
    const found = (await api.get(`/api/plugins/${PLUGIN}/data/episode?ids=${ids}&keys=template,phase`)) ?? {};
    for (const [slug, docs] of Object.entries(found)) {
      if (docs.template) out[slug] = docs.phase?.phase ?? 'OPEN';
    }
  }
  return out;
}

// ---------------------------------------------------------------- the command

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) out._.push(a);
    else if (a.includes('=')) out[a.slice(2, a.indexOf('='))] = a.slice(a.indexOf('=') + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

function loadState(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { players: {} };
}

function saveState(path, state) {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function main(argv) {
  const opts = args(argv);
  const command = opts._[0] ?? 'import';
  const url = opts.url ?? process.env.MC_APP_URL;
  const token = process.env.MC_TOKEN;
  if (!opts.file || !url) {
    console.error('usage: bingo-import.mjs [import|unclaim] --file past.json --url <site> [--apply] [--existing=merge] [--skip-invalid]');
    return 2;
  }
  const statePath = opts.state ?? opts.file.replace(/\.json$/i, '') + '.players.json';
  const state = loadState(statePath);

  if (command === 'unclaim') return unclaim(opts, url, token, state, statePath);

  const parsed = parse(readFileSync(opts.file, 'utf8'));
  if (parsed.fatal) {
    console.error(`✗ ${opts.file}: ${parsed.fatal}`);
    return 1;
  }
  const { file } = parsed;
  const problems = validate(file);
  const invalid = new Set(problems.map((p) => p.bingo).filter((b) => b !== undefined));
  for (const p of problems) console.log(`✗ ${p.at}: ${p.problem}`);

  if (!token) {
    console.error('MC_TOKEN is not set: a podcaster personal access token is needed to look the episodes up.');
    return 2;
  }
  const api = client(url, token);
  const episodes = await allEpisodes(api);
  const plan = [];
  file.bingos.forEach((bingo, b) => {
    if (invalid.has(b)) return;
    const match = matchEpisode(bingo.episode, episodes);
    if (match.problem) {
      console.log(`✗ bingos[${b}].episode: ${match.problem}`);
      invalid.add(b);
    } else {
      plan.push({ b, bingo, slug: match.slug });
    }
  });
  const existing = await existingBingos(api, plan.map((p) => p.slug));
  const onExisting = opts.existing === 'merge' ? 'merge' : 'skip';
  const todo = [];
  for (const p of plan) {
    const phase = existing[p.slug];
    const merge = (p.bingo.onExisting ?? onExisting) === 'merge';
    if (phase && !merge) console.log(`– bingos[${p.b}] ${p.slug}: already has a bingo, skipped (--existing=merge to add the cards)`);
    else if (phase && phase !== 'RESOLVED') console.log(`– bingos[${p.b}] ${p.slug}: its bingo is ${phase}, only a resolved one takes imported cards; skipped`);
    else {
      console.log(`✓ bingos[${p.b}] → ${p.slug}${phase ? ' (merge)' : ''}: ${p.bingo.cards.length} card(s)`);
      todo.push(p);
    }
  }

  console.log(`\n${todo.length} to import, ${invalid.size} invalid, ${plan.length - todo.length} skipped.`);
  if (!opts.apply) {
    console.log('Dry run: nothing written. Add --apply to import.');
    return invalid.size > 0 ? 1 : 0;
  }
  if (invalid.size > 0 && !opts['skip-invalid']) {
    console.error('Refusing to apply while bingos are invalid. Fix them, or add --skip-invalid to import the valid ones.');
    return 1;
  }

  const added = ensurePlayers(state, [...new Set(todo.flatMap((p) => p.bingo.cards.map((c) => c.player)))]);
  saveState(statePath, state);
  const batch = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const ids = [];
  for (const [n, p] of todo.entries()) {
    const id = `import:${batch}-${n + 1}`;
    await api.put(`/api/plugins/${PLUGIN}/data/site/main/${id}`, importDoc(p.bingo, p.slug, state, onExisting));
    ids.push(id);
  }
  console.log(`Handed over ${ids.length} bingo(s); waiting for the next update…`);

  const deadline = Date.now() + Number(opts.wait ?? 300) * 1000;
  let report = null;
  while (Date.now() < deadline) {
    report = (await api.get(`/api/plugins/${PLUGIN}/data/site/main/imports`)) ?? {};
    const done = new Set([...(report.applied ?? []), ...(report.rejected ?? [])].map((r) => r.id));
    if (ids.every((id) => done.has(id))) break;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  for (const id of ids) {
    const ok = report?.applied?.find((r) => r.id === id);
    const bad = report?.rejected?.find((r) => r.id === id);
    console.log(ok ? `✓ ${id} → ${ok.slug}` : bad ? `✗ ${id}: ${bad.reason}` : `… ${id}: not taken in yet`);
  }

  const names = file.players ?? {};
  console.log(`\nClaim codes (secret; also in ${statePath}) — hand each to its player:`);
  for (const key of Object.keys(state.players)) {
    const name = names[key]?.name ?? key;
    console.log(`  ${name.padEnd(24)} ${state.players[key].code}${added.includes(key) ? '' : '  (from an earlier run)'}`);
  }
  return 0;
}

/** Takes a used code back and issues a new one: for a code that reached the wrong person. */
async function unclaim(opts, url, token, state, statePath) {
  const player = state.players[opts.player];
  if (!player) {
    console.error(`no player "${opts.player}" in ${statePath}`);
    return 1;
  }
  if (!token) {
    console.error('MC_TOKEN is not set.');
    return 2;
  }
  const old = player.code;
  player.code = newCode();
  const api = client(url, token);
  await api.put(`/api/plugins/${PLUGIN}/data/site/main/unclaim:${hashOf(old).slice(0, 16)}`, {
    hash: hashOf(old),
    newHash: hashOf(player.code),
  });
  saveState(statePath, state);
  console.log(`The old code stops working on the next update. New code for ${opts.player}: ${player.code}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`✗ ${error.message}`);
      process.exit(1);
    },
  );
}
