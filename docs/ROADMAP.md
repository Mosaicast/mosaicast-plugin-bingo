<!--
SPDX-License-Identifier: AGPL-3.0-or-later
SPDX-FileCopyrightText: 2026 The Mosaicast Authors
-->

# Roadmap

Ideas recorded but not built, and why each one is waiting. `ARCHITECTURE.md` and `BRIEF.md` are read-only
specs. This file is repo-local and is updated as items move.

## Waiting on the platform

### Personal history ("your last bingos")
The only path today is a browser schema read filtered by the viewer's own author id, which works only
*because* of the leak above. The backend also can't write into a `USER` partition (`DocStore` throws on
that scope). So there is nowhere private to publish a person's own history to them.
- Needs either a backend-writable, owner-readable per-user document, or schema reads that core filters by
  row owner.

### A "closes on …" deadline on the feed badge
The badge now says "Predict before it airs" for an announced episode, but it can't give a date. The SDK
carries `announceAt` and no scheduled release instant: a release happens when the feed item arrives.
- Needs a planned release time on `DisplaySnapshot` / `ctx.episode`.

## Not needed yet

### Live tick-off
While a podcaster ticks answers off, viewers see the result only on their next read. Live updates would
need polling or a push channel, and they would have to respect the spoiler cover (`ctx.progress` is
per-device). Not needed for now.

### Backend enforcement of duplicate squares
The card editor stops a player saving the same prediction twice, but only in the browser. A direct write
to one's own partition can't be refused. The tick could ignore the second copy when it ingests a card.
- Cost: one more rule in `BingoRecord.ingest`, plus a test.

### A discovery index for large back catalogues
Each tick still reads `template` once per episode on the site, because `DocStore` has no cross-scope
query. That's cheap at today's sizes. For thousands of episodes, a backend-owned index of slugs that have
a bingo, refreshed by a slow full scan, would make the per-tick cost proportional to the number of bingos.

### A history line for everyone listed
The `history` document carries series for the best 50 listed players, the same cap as the standings, so
a listed player further down has no line of their own. The fix belongs with personal history (above): a
per-user readable document would carry the viewer's own series however far down they are.

### A podcaster upload dialog for past bingos
Importing is a script for now (`scripts/bingo-import.mjs`). The backend path is the import document, which
a dialog on the page could write just as well: file picker, the same dry-run report, then apply. It's worth
building once a second podcast wants to import.

### An admin's full export
A person's own cards reach core's data export as `plugins/bingo/bingo.json` (core 0.8.0). An admin export
with everyone's cards stays an ops script: it is never offered to players, because being listed covers a
name and a score, not a card.

### Anonymous suggestions
Suggestions are for signed-in players only, because only they can fill in a card. If anonymous visitors
get a read-only "popular predictions" panel, its on/off switch belongs in `localStorage` behind a
declared `functional` consent service, the pattern `mosaicast-plugin-stats` uses.
