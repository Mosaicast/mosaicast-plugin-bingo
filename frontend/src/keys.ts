// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

/**
 * The doc-store keys this plugin uses, in one place so the frontend and `BingoDocs`' constants cannot
 * drift apart silently.
 *
 * Which of these the browser may write is not a matter of taste: everything marked backend-owned below is
 * declared in the manifest, so a `PUT` to it is refused with a 403 whose problem type is
 * `problems/backend-owned-key`. The browser writes `template`, `resolution`, `control`, `showcase` and `grouping`; a
 * player writes only into their own partition.
 */

/** Grid and title. Written by the podcaster; its presence is what makes an episode have a bingo. */
export const KEY_TEMPLATE = 'template';

/** The shared truth list, keyed by a candidate's canonical form. Written by the podcaster. */
export const KEY_RESOLUTION = 'resolution';

/** The podcaster's lifecycle intent. Written here, obeyed by the backend over its own suggestion. */
export const KEY_CONTROL = 'control';

/**
 * The podcaster's corrections to the automatic grouping: which written entry belongs in which group.
 * Written by the podcaster, applied on the backend's next pass — so deliberately not backend-owned.
 */
export const KEY_GROUPING = 'grouping';

/** Which players a podcaster has chosen to feature. Written by the podcaster. */
export const KEY_SHOWCASE = 'showcase';

/** Backend-owned: the derived lifecycle state. Read-only from the browser. */
export const KEY_PHASE = 'phase';

/** Backend-owned: cards are invisible here, so this list can only be computed on the backend. */
export const KEY_CANDIDATES = 'candidates';

/** Backend-owned: what happened, in a few lines. Empty until the bingo is resolved, like the board. */
export const KEY_RECAP = 'recap';

/** Backend-owned: per-episode scores, for players who allow being listed. */
export const KEY_LEADERBOARD = 'leaderboard';

/**
 * Backend-owned: who could be featured, as ids only.
 *
 * A podcaster's browser cannot read anyone else's card — they live in their authors' own partitions — so
 * the picker is built from this list and `ctx.users`, never from the cards themselves.
 */
export const KEY_PARTICIPANTS = 'participants';

/**
 * Backend-owned: the featured cards, copied out for everyone to read.
 *
 * The copy is the whole point: an anonymous visitor can no more read a player's partition than a podcaster
 * can, so a featured card has to be republished into the episode scope to be renderable at all.
 */
export const KEY_SHOWCASED = 'showcased';

/**
 * Backend-owned, in the site scope: predictions several people keep making, for the card editor to offer.
 * Never one person's own words — the backend publishes only what at least two different people wrote.
 */
export const KEY_SUGGESTIONS = 'suggestions';

/** Backend-owned, in the site scope: cumulative standings. */
export const KEY_STATS = 'stats';

/**
 * A player's own card, in their own partition (`data/user/me/...`).
 *
 * The partition is flat — one per person, not one per person and episode — so the episode goes in the key.
 */
export function cardKey(episodeSlug: string): string {
  return `${CARD_PREFIX}${episodeSlug}`;
}

/** The prefix every one of a player's cards shares, for listing their own partition. */
export const CARD_PREFIX = 'card:';

/**
 * A player's own visibility preferences, in their own partition.
 *
 * Deliberately **not** per episode: it is a standing choice about how this person wants to appear, so the
 * card form prefills from it and saving a card updates it. Answering the same question every episode is
 * how a preference becomes noise people stop reading.
 */
export const KEY_PREFS = 'prefs';
