// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

import { describe, expect, it } from 'vitest';
import { PLATFORM_API_VERSION } from '@mosaicast/plugin-sdk';
import manifest from '../../plugin.json';
import {
  KEY_CANDIDATES,
  KEY_CONTROL,
  KEY_GROUPING,
  KEY_LEADERBOARD,
  KEY_PHASE,
  KEY_RECAP,
  KEY_RESOLUTION,
  KEY_PARTICIPANTS,
  KEY_SHOWCASE,
  KEY_SHOWCASED,
  KEY_STATS,
  KEY_SUGGESTIONS,
  KEY_TEMPLATE,
} from './keys';

describe('plugin.json', () => {
  it('pins platformApi to the SDK this bundle is built against', () => {
    // Never a literal: the host matches major.minor exactly and refuses the plugin on a mismatch, so the
    // one thing that must not drift is this pair.
    expect(manifest.platformApi).toBe(PLATFORM_API_VERSION);
  });

  it('reserves every key the backend computes', () => {
    const owned = manifest.data.backendOwned;
    for (const key of [KEY_PHASE, KEY_CANDIDATES, KEY_LEADERBOARD, KEY_RECAP, KEY_STATS, KEY_SUGGESTIONS,
                       KEY_PARTICIPANTS, KEY_SHOWCASED]) {
      expect(owned).toContain(key);
    }
  });

  it('reserves none of the keys the browser has to write', () => {
    // Reserving a client-written key does not protect anything — it 403s the plugin against its own UI.
    const owned = manifest.data.backendOwned;
    for (const key of [KEY_TEMPLATE, KEY_RESOLUTION, KEY_CONTROL, KEY_SHOWCASE, KEY_GROUPING]) {
      expect(owned).not.toContain(key);
    }
  });

  it('lets anonymous visitors read and keeps writes above fan', () => {
    // `writableBy: podcaster` still lets a fan save their own card: the USER scope is exempt from both
    // floors. Lowering it to `fan` would instead let any fan overwrite the template and every host card.
    expect(manifest.data.readableBy).toBe('anonymous');
    expect(manifest.data.writableBy).toBe('podcaster');
  });

  it('declares only placements the shell actually renders', () => {
    // `admin` passes validation and is mounted by no region, so a board declared there would load cleanly
    // and be invisible. `sidebar` is gone on purpose: the podcaster's controls live on the tile itself,
    // where the thing they act on is.
    const placements = manifest.slots.map((s) => s.placement);
    expect(placements).not.toContain('admin');
    expect(placements).not.toContain('sidebar');
    expect(placements).toEqual(expect.arrayContaining(['card', 'main', 'page']));
  });

  it('declares its page at the site scope, with a menu entry the host actually parses', () => {
    // `/p/bingo/*` is a real 404 without a site-scoped page slot.
    expect(manifest.slots).toContainEqual(
      expect.objectContaining({ scope: 'site', placement: 'page', element: 'bingo-page', visibleTo: 'anonymous' }),
    );
    const nav = (manifest as unknown as { nav: Record<string, unknown>[] }).nav;
    expect(nav).toEqual([{ path: '', label: 'Bingo', icon: 'dice' }]);
    // The SDK's TS type calls the gate `role`; core parses `visibleTo`. A `role` key would be ignored.
    for (const entry of nav) expect(entry).not.toHaveProperty('role');
  });

  it('declares an element for every slot', () => {
    for (const slot of manifest.slots) {
      expect(manifest.frontend.elements).toContain(slot.element);
    }
  });

  it('declares the identity surface it renders the leaderboard with', () => {
    // Without this block `ctx.users` is null and every fan is an anonymous placeholder.
    expect(manifest.identity.resolvesUsers).toBe(true);
  });

  it('declares the notification surface, with a per-user ceiling', () => {
    // The one surface that writes into somebody else's experience, so an operator should be able to read
    // the ask off the manifest. What it gets is the operator's cap over this number.
    expect(manifest.notifications.sends).toBe(true);
    expect(manifest.notifications.perUserPerDay).toBeGreaterThan(0);
  });

  it('reserves the record of who has already been told', () => {
    // Client-writable, this would let anyone suppress or replay a resolution announcement.
    expect(manifest.data.backendOwned).toContain('notified');
  });

  it('asks for the tag vocabulary without the power to retag episodes', () => {
    expect(manifest.tags.readsVocabulary).toBe(true);
    expect(manifest.tags.writesEpisodes).toBe(false);
  });

  it('stores no name on any row', () => {
    // Names come from ctx.users at render. A column here would outlive the rename meant to shed it.
    const fields = Object.values(manifest.storage.schema).flatMap((e) => Object.keys(e));
    expect(fields).not.toContain('label');
    expect(fields).not.toContain('displayName');
  });

  it('declares schema entities whose names the host will accept', () => {
    const entities = Object.keys(manifest.storage.schema);
    expect(entities.length).toBeGreaterThan(0);
    for (const entity of entities) {
      expect(entity).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,39}$/);
      // The table is `plugin_bingo_<entity>` and the host caps that at 47 characters.
      expect(`plugin_bingo_${entity}`.length).toBeLessThanOrEqual(47);
      for (const field of Object.keys(manifest.storage.schema[entity as keyof typeof manifest.storage.schema])) {
        expect(field).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,39}$/);
        expect(field).not.toBe('id'); // assigned by the platform; declaring it is refused
      }
    }
  });
});
