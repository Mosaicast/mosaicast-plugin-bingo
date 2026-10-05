# mosaicast-plugin-bingo

> Episode plugin: everyone fills in their own bingo card, one shared resolution scores them all, and a site page keeps the standings.

Part of **[Mosaicast](https://github.com/mosaicast)** — an extensible website platform for podcasts.
Status: **v1 in development**.

## What it does

Everyone fills in their own bingo card for an episode, hosts and fans alike. When the episode lands, the
podcaster ticks entries off **one shared list** — the plugin merges the different ways people wrote the
same prediction, so "Alex says 'damn it'", "alex says damn it!" and "Alex says: Damn it" appear once, and
every card scores against the same truth.

See `docs/ARCHITECTURE.md` for the platform picture and `docs/BRIEF.md` for the original scope. Where this
implementation departs from the BRIEF, and why, is listed under [Design notes](#design-notes).

## Lifecycle

A bingo exists only once a podcaster creates a template, and it ends for good when it is archived.

| Phase | Starts when | Who can edit a card | What is recorded |
|---|---|---|---|
| `OPEN` | the template is created | anyone signed in | every tick, ranked |
| `LOCKED` | the episode is released, or the podcaster locks | writes still land, but | cards freeze; a newcomer is taken once, unranked |
| `RESOLVED` | the podcaster finishes ticking off | same | final scores; host standings recomputed |
| `ARCHIVED` | `archiveAfterDays` after resolving, or manually | nothing reads it | nothing, ever again |

The podcaster's decision always beats the automatic suggestion — locking on release is a default, not a
wall, and a locked bingo can be reopened until it is resolved. Someone catching up after the lock can
still fill in a card and see how they did; it is shown as **played late, not ranked**.

### A bingo for an episode that has not aired

This is what the plugin is for, and since core 0.7.7 it is how it works end to end. A podcaster plans the
episode in the admin area and creates its bingo while the plan is **quiet** — only podcasters and admins can
see either. Once the episode is **announced** (by hand, or at its announcement time) everyone can fill in a
card. When the feed item arrives and the plan is **released**, predictions close by themselves: the host
tells the plugin at that moment, and every tick also checks the episode's phase, so a release the plugin
did not hear about still closes on the next pass. A withdrawn episode keeps its lock.

Nothing about a quiet episode leaks out. Its documents are hidden by the host like the episode itself; the
site-wide standings leave its cards out; and if a podcaster resolves it before it is announced, the
notifications wait until it is.

## Making one

A podcaster on an episode with no bingo gets a panel: pick a grid (3x3, 4x4, 5x5), name it, optionally give
the middle square away, create. Everyone can fill in a card from the moment it exists.

The middle square is **yours to write by default**. Giving it away is a deliberate choice per bingo, and it
only means anything under line scoring — on a 3x3 the middle sits on four of the eight lines.

## Importing past bingos

Bingos played before a site ran Mosaicast can be imported with `scripts/bingo-import.mjs` and a
podcaster's personal access token. It does a dry run first and imports only with `--apply`. Imported
bingos are resolved bingos like any other: scored exactly as the file marks them, ranked, and part of the
history and charts.

Players are never attached to an account by the importer. Each one gets a **claim code** and counts
without a name until the person enters that code on `/p/bingo/`. The full format, the rules, and what is
refused and why are in [`docs/import-format.md`](docs/import-format.md).

## Filling in a card

The editor checks a card's own squares as you type, in the browser and without asking the backend. A
square that repeats another word for word (after case, accents and punctuation are folded away) blocks
saving, because one event would tick off both. A square merely *close* to another, by the site's
`fuzzyThreshold`, gets a hint that the two will most likely count as the same prediction. The threshold
comes from the `phase` document, because there is no `ctx.config` in a browser.

These checks use a browser copy of the backend's comparison rules (`frontend/src/fuzzy.ts`). It only
advises: grouping stays the backend's decision. `shared/fuzzy-vectors.json` holds both halves to the same
answers, and the Java and the TypeScript test suites both read it.

**Suggestions.** Signed-in players get chips with what several people keep predicting across the site,
next to the site's tags. They come from a backend-owned site document, `suggestions`. It's built only
from episodes everyone can see, and only from predictions **at least two different people** wrote, so
one person's own words are never offered to anybody else. A "came true" count is included only for
resolved bingos. A *Show suggestions* switch turns the chips off. It's saved to the player's own `prefs`
the moment it's flipped, and the backend never reads it.

## Scoring

Two quantities, both always counted:

- **Fields** — squares that came true.
- **Lines** — completed rows, columns and diagonals; `2n+2` of them on an n-by-n grid.

The site's `rankBy` setting decides which one orders the leaderboard, and the other always breaks the tie.
The card tabs and the feed badge lead with whichever one that is.
The default is lines, which is bingo as people expect it — and the only scoring under which a free middle
square means anything, since on a 3x3 it sits on four of the eight lines.

## Results

The leaderboard appears **only once the bingo is resolved**. Before that it says how many are taking part
and nothing else: a board that creeps upward while the answers are being ticked off would tell anyone
watching how much has already come true, which is exactly what the spoiler cover exists to prevent.

It is bounded too — 50 rows in the published document, five on screen. **Scoring is not bounded**: every
card is scored and stored. The board also carries a tally of how many share each score, so a reader in 73rd
place still sees themselves in 73rd, even though no row for them was ever published. It counts everyone
who played, opted out included — they are precisely the readers with no published row, so leaving them out
would empty the tally of its purpose and misplace everybody else. It costs an entry per distinct score
rather than per player, and names nobody.

### What happened

Once a bingo is resolved, a backend-owned `recap` document sums it up: the most predicted thing and
whether it came true, the rarest hit, the biggest miss, the average card, and how many cards got a line.
It's empty until the resolution, like the board, and the tile keeps it behind the spoiler cover because it
names what happened.

### Site standings

Cumulative standings across every **resolved** bingo, for players who allow being listed, on episodes
everyone can see. An unresolved bingo is left out: its scores move with every tick-off, and counting them
would leak the progress the episode's own board withholds.

## The bingo page and sharing

`/p/bingo/` is the plugin's own page, reached from a *Bingo* menu entry:

| Path | Shows |
|---|---|
| `/p/bingo/` | the site standings and every bingo, with live episode titles |
| `/p/bingo/e/<slug>` | one bingo: board, recap (behind the spoiler cover) and a way into the episode |
| `/p/bingo/e/<slug>/u/<user>` | one player's result, as the published board shows it |

Every other subpath is a real 404 (`PageRouteProvider`). That includes a quiet episode's bingo, and the
result of a player who opted out or is past the board's cap. Each page has an OpenGraph card
(`ShareMetadataProvider`) in the site's default language. A card says how many played and how a card
scored, **never what was predicted or came true**, because a link preview is read in chats by people who
may not have listened.

### How past bingos went

Below the standings, the page charts every **resolved** bingo on an episode everyone may see. It follows
the stats plugin's design: hand-drawn SVG, season pills, tiles, records, and the same validated player
palette.

- **Tiles:** bingos, cards, the average card, cards with a line, and predictions that came true.
- **Form over the season:** a line per player, in *per episode*, *running total* or *place* mode
  (standing after each bingo). The viewer's own line is emphasised. Up to eight players can be picked,
  and each keeps their colour under any filter. A crosshair tooltip and a table view are included.
- **Cards per bingo**, **how predictable each episode was** (against the average) and **how cards score**.
- **Records:** best single card, most bingos played, longest run with a line, the most and least
  predictable episode, and the safest prediction.

All of it comes from one backend-owned site document, `history` (`BingoHistory`, recomputed with the
dirty-gated roll-up). Only players who allow being listed get a line, capped at the best 50 like the
standings. Everything that names nobody counts every card, so places stay true. A bingo's own page
adds how its cards scored and how predictable it was compared with the rest.

The tile and the page have a *Share* button. It shares the player's own result once the published board
carries it, and the bingo itself otherwise.

## The feed badge

One line per episode card, most specific first:

1. "not announced yet", on a quiet episode, for the podcaster who can see it
2. the viewer's own score, once the published board carries it
3. "Your card is in", or "Fill in your card" / "Predict before it airs" while predictions are open
4. the best score
5. where the bingo stands

Whether the viewer has played comes from **one** listing of their own partition per page, shared by every
badge.

## When a card can change

Freely, until predictions close. After that the backend never re-reads a card it already has, so the tile
stops offering an edit rather than accepting one that would do nothing.

The exception is somebody who has not played yet: while late entries are allowed they may **hand a card in
once**, it is read exactly once, and it cannot be changed afterwards. The button says so.

## Resolving

Lifecycle changes are a request, not an instant switch: pressing one writes the intent, and the backend
applies it on its next pass (`ingestIntervalSeconds`, 60 by default). The tile says so while it waits.

While predictions are open a podcaster gets both *Lock predictions* and *Resolve* — resolving without
locking first is allowed, because an episode that has already aired does not need the intermediate step.
After the lock the pair becomes *Resolve* and *Reopen predictions*. *Resolve* opens a dialog to tick off
what actually happened, and confirming records a decision for **every** candidate, ticked or not — which
is what makes the next part exact.

Terms that arrive afterwards (someone playing late) are the ones with no decision, so the button becomes
*Catch up (n)* and the dialog shows only those. No timestamps involved.

### Correcting the grouping

Each candidate in the resolve dialog opens up to show the spellings grouped into it. A podcaster can
**split** a spelling off into a group of its own, or **merge** a whole candidate into another. The
corrections are pins on a client-written `grouping` document, keyed by the spelling as written, and the
backend applies them on its next pass. They apply to frozen cards too: what freezes is what a card
*says*, but which group a square belongs to is a judgement the podcaster can still correct, so a row's
group follows the current grouping and a merge re-scores. The dialog says when a correction hasn't landed
yet. It works this out from the published result, not from a clock. If a merge joins two candidates that
were decided differently, the target's decision wins, and the dialog warns before that happens.

Two guarantees sit under this:

- **A decided group keeps its name.** Left alone, a group is named after its first member in sorted
  order, so a late spelling that sorts earlier would rename a decided group and orphan its decision.
  Decided groups are seeded before matching.
- **After the freeze, everything derived comes from the record.** The candidate list, its counts and
  featured cards are built from the frozen rows, not from partition documents that their owners can
  still write.

## Who plays, and how they are named

**Everyone plays as themselves.** There is one card shape and it lives in its author's own partition;
nobody types a name anywhere. Names and avatars are resolved through `ctx.users` at the moment a row is
drawn, so nothing here holds a copy of a name that would outlive the rename meant to shed it or the erasure
meant to end it. A row whose author is gone keeps its score and reads *Former listener*.

A podcaster can **feature** some cards, which gives them the prominent tabs at the top. Because no browser
can read another person's partition — the podcaster's included — the backend publishes the candidate list
for the picker and copies the chosen cards out so anyone can read them.

## Choosing how you appear

Two switches, in each person's own data, prefilled from their last save and never asked per episode:

- **Show me on the leaderboard** — a name and a score, publicly.
- **My card may be featured** — the whole card, as a tab.

Both default to yes and sit next to the save button. Opting out is a choice about what *other people* see,
and nothing more: someone who opts out is still scored, still counted in how many are taking part, still
placed by the tally so their own screen can tell them where they came, and still told when the bingo
resolves. And the opt-out is enforced by the backend on every tick rather than trusted from the podcaster's
pick, so a selection made before someone changed their mind stops publishing them.

## Being told it resolved

When a podcaster resolves a bingo, everyone who filled in a card gets one in-app notification linking back
to the episode — in every language this plugin speaks, because it may be read days later by someone whose
shell has since changed language.

Ranked players and latecomers are told different things, since *"see how your card scored"* and *"your card
is not ranked"* are not the same news. Nobody is told twice: the backend records who it has told, which is
also what lets someone who joins after the resolution be told on a later tick.

Both surfaces are opt-in manifest blocks. Without `identity` every player is a placeholder; without
`notifications` nothing is sent. Neither failure is loud, and neither breaks the tile.

A third declaration is not optional: `data.readsAllUsers`. Every card lives in its player's own partition,
so the tick has to read all of them, and since `platformApi` 0.16.0 that read exists only for a plugin that
declares it — the admin plugin page says so to the operator. Without it the plugin refuses to register.

## Why the tile reads its episode in one request

Everything the tile shows about an episode can appear after someone first looks at it: the template when a
podcaster creates the bingo, the phase, candidates and leaderboard when the backend's tick writes them. The
host's `ctx.docs.get` remembers "not set" for 30 seconds (it was the life of the page before core 0.7.5),
and the re-read after a podcaster's own action falls inside those 30 seconds — a phase or candidate list the
tick wrote meanwhile would stay hidden. The tile and the feed badge therefore read their
episode through the host's uncached batch endpoint — one request each. There is still no polling: the tile
re-reads when it is opened and after the viewer's own actions.

## Build & test

```bash
./build.sh                                   # -> dist/
cd backend && ./gradlew test                 # 138 tests, no core and no database
cd frontend && npm test && npm run typecheck # 141 tests
node --test scripts/*.test.mjs               # the import script
```

`build.sh` writes only `dist/` — `plugin.json`, `bingo.jar`, `assets/bingo.es.js`.

## Build & install

```bash
./build.sh
MOSAICAST_PLUGINS_DIR=/path/to/plugins ./install.sh   # then restart core
```

Plugins are read once, at startup, so a rebuilt jar or a changed manifest needs a restart; the frontend
bundle is served with `no-cache` and only needs a browser reload.

Against a `mosaicast-core` checkout (0.7.6 or newer), a named dev instance is a disposable, seeded stack
of its own — Postgres, ports and plugins directory under `/tmp/mosaicast-dev/<name>/` — so it runs beside
anyone else's without touching core's `./plugins`:

```bash
C=../mosaicast-core/dev/instance.sh
$C --name bingo up --plugin-dir "$PWD/dist"   # repeat --plugin-dir to load other plugins beside it
source <($C --name bingo env)                 # MC_APP_URL — ports are allocated, not fixed
$C --name bingo status                        # which plugin ids actually loaded
$C --name bingo down
```

`--plugin-dir` copies `dist/` at `up`; after a rebuild, `$C --name bingo restart --plugin-dir "$PWD/dist"`
re-copies it and restarts only the app, keeping the database (add `--core origin/master` to move core too). Without it
(or `--plugins`) no plugin loads and the tile is simply absent.

Requires **core 0.7.7 or newer** (`platformApi` 0.18.0). Core matches that version on `major.minor` exactly,
so an older core rejects this build at load and a newer minor rejects it too.

If the tile does not appear, the reason is in the admin log viewer at `/admin/logs` — a rejected manifest
disables only this plugin, quietly, which looks exactly like a render bug and is not one.

## Structure

```
plugin.json              the manifest: slots, schema, access floors, config
backend/                 Java 21, PF4J extension, depends only on the SDK
  src/main/java/dev/mosaicast/plugin/bingo/
    BingoPlugin.java     register + the scheduled tick, and every extension point
    BingoDocs.java       doc keys, document records, row shapes
    BingoLifecycle.java  the phase: podcaster intent + episode release + archive timer
    BingoRecord.java     cards into schema rows (the freeze), scoring
    BingoPublish.java    featured cards, notifications, site standings, suggestions
    BingoPages.java      which /p/bingo/ subpaths exist, and their share cards
    BingoHistory.java    pure: the history the site page charts
    BingoImport.java     past bingos taken in from import documents, and claims
    BingoExport.java     a person's own cards as mosaicast-bingo/1
scripts/bingo-import.mjs the importer (dry run, --apply, unclaim); docs/import-format.md
    BingoFuzzy.java      pure entry grouping — no ctx, no clock, no I/O
frontend/                React 18 + Vite, bundled as one ES module
  src/bingo-element.tsx  defines the custom elements (tile, feed badge, page)
  src/fuzzy.ts           the browser's advisory copy of the comparison rules
  src/regroup.ts         pins for the podcaster's split/merge corrections
  src/history.ts         pure transforms for the history charts; src/palette.ts the player colours
  src/components/charts/ hand-drawn SVG line and bar charts
  src/components/        the tile, the feed badge, the page, the resolve dialog
shared/fuzzy-vectors.json  one answer key for the Java and TypeScript comparison rules
docs/ROADMAP.md          ideas recorded but not built, and what each is waiting on
  locales/{en,de}.json   UI strings
```

## Configuration

Set per site in the admin panel; the form is generated from the manifest, with a translated name and
explanation for each field. Since core 0.7.2 a **podcaster** can open it too and edit the fields marked
`podcaster` below. `rankBy` stays with the admin: a podcaster sees that it exists, marked hidden, but not its
value. Numbers carry bounds the host enforces on save; a stored value outside them counts as unset.

| Key | Default | What it does |
|---|---|---|
| `ingestIntervalSeconds` | 60 | how often cards are collected and scores recomputed, 10–3600 — a saved change applies within one old interval, no restart |
| `fuzzyThreshold` | 0.82 | how similar two entries must be to count as one thing, 0–1 |
| `defaultGridSize` | 3 | grid used when a template does not say — the tick writes it into that template, so the browser reads the same number. A dropdown of 3x3 / 4x4 / 5x5 |
| `rankBy` | `lines` | whether lines or fields order the leaderboard; the other breaks the tie. A dropdown, not free text — the manifest declares the two values it accepts |
| `allowLateEntries` | true | whether someone can still play after the lock |
| `archiveAfterDays` | 30 | days after resolving before a bingo closes for good, 1–3650 |

## Design notes

Five things differ from `docs/BRIEF.md`, which predates the current plugin contract:

- **The lifecycle does not come from `ctx.episode`.** That field says where the *episode* stands (filled
  since core 0.7.7); a bingo's state also depends on what the podcaster asked for, so the backend merges the
  two and publishes the result as a document.
- **There is no podcaster slot at all.** `admin` passes validation and is rendered by no region; `sidebar`
  put the one action a podcaster comes for below everything else on a phone. It is a dialog on the tile.
- **Fan cards live in the `USER` scope**, not under a `card:fan:{userId}` key. Doc keys are client input
  and scope ids are public slugs, so a key naming a user is an IDOR.
- **Storage is doc *and* schema.** The doc store's only query is by key prefix, with no filtering,
  ordering or aggregation — which is exactly what per-entry frequency and cross-episode standings need.
- **There are no host cards.** The BRIEF gave hosts their own authored cards with typed-in names; since
  platformApi 0.13.0 the host resolves a user id to a name and avatar, so everyone plays as themselves and
  a podcaster features whichever cards deserve the spotlight.

And one thing worth stating plainly: **a person's write to their own partition cannot be refused** — that
is what makes the partition private. Integrity comes from the backend freezing entries into the schema at
`LOCKED`. After that the row is the record and the document is a scratchpad nothing reads, so a late edit
changes nothing. Scores keep updating past the freeze, because the podcaster is still ticking off answers:
what freezes is what a card *says*, never what it is worth.

## Known limitation: the schema read surface

Core serves this plugin's schema tables over HTTP under the same `data.readableBy` floor as its
documents. That floor is `anonymous`, because the tile is public. So the raw rows (entries, scores,
author ids) are readable more widely than anything the plugin publishes itself. That includes rows from
quiet episodes and from players who opted out of the leaderboard. The plugin can't close this on its own.
A separate schema floor is proposed in [core#261](https://github.com/Mosaicast/mosaicast-core/issues/261)
and [sdk#99](https://github.com/Mosaicast/mosaicast-plugin-sdk/issues/99). Nothing in the frontend reads
`ctx.schema`, so the floor can move to `admin` the day it exists. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Contributing

Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). In short: `git commit -s` (DCO,
required), SPDX header in new files, add tests.

## License

**GNU Affero General Public License v3.0 or later** — see [`LICENSE`](LICENSE). Header per source file:
```
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors
```

## Name & trademark

"Mosaicast" and the logo denote the official project. Please rename forks.
