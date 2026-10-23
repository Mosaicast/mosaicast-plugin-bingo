<!--
SPDX-License-Identifier: AGPL-3.0-or-later
SPDX-FileCopyrightText: 2026 The Mosaicast Authors
-->

# Roadmap

Ideas recorded but not built, and why each one is waiting. `ARCHITECTURE.md` and `BRIEF.md` are read-only
specs. This file is repo-local and is updated as items move.

## Waiting on the platform

### A "closes on …" deadline on the feed badge
The badge now says "Predict before it airs" for an announced episode, but it can't give a date. The SDK
carries `announceAt` and no scheduled release instant: a release happens when the feed item arrives.
- Needs a planned release time on `DisplaySnapshot` / `ctx.episode`.

## Not needed yet

### Personal history ("your last bingos")
Possible since `platformApi` 0.20.0: an action answers for its caller only, so a `my-history` action could
read the caller's own rows and return them, with nothing published anywhere. Before that there was nowhere
private to put a person's own history.
- Cost: one action, a panel on the site page, and tests for "only your own rows".

### Live tick-off
While a podcaster ticks answers off, viewers see the result only on their next read. Draft rounds brought
channels (`platformApi` 0.20.0), so the push side exists now; it would still have to respect the spoiler
cover (`ctx.progress` is per-device) and stay within the rule that nothing public reflects an unresolved
score. Not needed for now.

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
A person's own cards reach core's data export as `plugins/bingo/bingo.json` (core 0.8.1). An admin export
with everyone's cards stays an ops script: it is never offered to players, because being listed covers a
name and a score, not a card.

### Anonymous suggestions
Suggestions are for signed-in players only, because only they can fill in a card. If anonymous visitors
get a read-only "popular predictions" panel, its on/off switch belongs in `localStorage` behind a
declared `functional` consent service, the pattern `mosaicast-plugin-stats` uses.
