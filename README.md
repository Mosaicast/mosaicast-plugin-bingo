# mosaicast-plugin-bingo

> Episode plugin: a bingo card per host and per fan, one shared resolution, and a leaderboard.

Part of **[Mosaicast](https://github.com/mosaicast)** — an extensible website platform for podcasts.
Status: **v1 in development**.

## What it does

Every host keeps their own bingo card for an episode; fans fill in theirs. When the episode lands, the
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
| `LOCKED` | the episode publishes, or the podcaster locks | writes still land, but | cards freeze; a newcomer is taken once, unranked |
| `RESOLVED` | the podcaster finishes ticking off | same | final scores; host standings recomputed |
| `ARCHIVED` | `archiveAfterDays` after resolving, or manually | nothing reads it | nothing, ever again |

The podcaster's decision always beats the automatic suggestion — locking on publication is a default, not
a wall, and a locked bingo can be reopened until it is resolved. Someone catching up after the lock can
still fill in a card and see how they did; it is shown as **played late, not ranked**.

## Making one

A podcaster on an episode with no bingo gets a panel: pick a grid (3x3, 4x4, 5x5), name it, optionally give
the middle square away, create. Everyone can fill in a card from the moment it exists.

The middle square is **yours to write by default**. Giving it away is a deliberate choice per bingo, and it
only means anything under line scoring — on a 3x3 the middle sits on four of the eight lines.

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
cd backend && ./gradlew test                 # 73 tests, no core and no database
cd frontend && npm test && npm run typecheck # 60 tests
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

Requires **core 0.7.6 or newer** (`platformApi` 0.17.0). Core matches that version on `major.minor` exactly,
so an older core rejects this build at load and a newer minor rejects it too.

If the tile does not appear, the reason is in the admin log viewer at `/admin/logs` — a rejected manifest
disables only this plugin, quietly, which looks exactly like a render bug and is not one.

## Structure

```
plugin.json              the manifest: slots, schema, access floors, config
backend/                 Java 21, PF4J extension, depends only on the SDK
  src/main/java/dev/mosaicast/plugin/bingo/
    BingoPlugin.java     register + the scheduled tick, and UserDataHandler
    BingoFuzzy.java      pure entry grouping — no ctx, no clock, no I/O
frontend/                React 18 + Vite, bundled as one ES module
  src/bingo-element.tsx  defines the three custom elements
  src/components/        the tile, the feed badge, the podcaster board
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

Four things differ from `docs/BRIEF.md`, which predates the current plugin contract:

- **The lifecycle does not come from `ctx.episode.status`.** The shell has never populated that field, so
  the backend derives the phase and publishes it as a document.
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
