# Project: Mosaicast – mosaicast-plugin-bingo

Episode plugin: a bingo card per host and per fan, one shared fuzzy-deduplicated resolution, a four-state
lifecycle, and schema-backed history.

## Read first (mandatory)
- `docs/ARCHITECTURE.md` — source of truth for the platform.
- `docs/BRIEF.md` — the original scope. **Predates the current plugin contract; see "Deviations" below.**
  Where the BRIEF and the SDK disagree, the SDK wins.

Work in plan mode first.

## Tech stack
Java 21 (Gradle, PF4J extension) · React 18 + Vite (Web Component) · **platformApi 0.14.0** (core 0.7.x)

## Commands
```
./build.sh                                    # -> dist/{plugin.json,bingo.jar,assets/bingo.es.js}
cd backend  && ./gradlew test                 # 57 tests
cd frontend && npm test && npm run typecheck  # 40 tests
scripts/set-version.sh <x.y.z>                # bumps the plugin version in all three files
```

## Structure
```
plugin.json                             manifest: slots, storage.schema, data floors, config
backend/src/main/java/dev/mosaicast/plugin/bingo/
  BingoPlugin.java                      register + the scheduled tick + UserDataHandler
  BingoFuzzy.java                       pure entry grouping (no ctx, no clock, no I/O)
backend/src/test/.../BingoSchemaFixture.java   builds FakeSchemaStore FROM plugin.json
frontend/src/bingo-element.tsx          defines the three custom elements
frontend/src/{keys,types}.ts            doc keys and document shapes — mirror BingoPlugin's records
frontend/src/components/                EpisodeBingo, EpisodeCardBadge, ResolutionBoard, useBingo
frontend/locales/{en,de}.json           UI strings
```

## Conventions (binding)
- Java packages `dev.mosaicast.*`; npm scope `@mosaicast`.
- Plugins import ONLY against the SDK, never core.
- `platformApi` must match the built SDK version, in `plugin.json`, `plugin-api`, `plugin-testkit` and
  `@mosaicast/plugin-sdk` — CI compares all four literally.
- Never commit secrets; `.env` / environment variables.
- **Tests are part of the work.** CI must stay green.
- **Document public APIs** (Javadoc/TSDoc); take SDK signatures from the built SDK, don't guess.
- **Sign off commits** (`git commit -s`, DCO).
- **SPDX header in EVERY new source file**, shell scripts included:
  `// SPDX-License-Identifier: AGPL-3.0-or-later`
  `// SPDX-FileCopyrightText: 2026 The Mosaicast Authors`
  Fixed holder — never from git config. CI blocks PRs without it.

## Contract facts this plugin depends on (verified, not assumed)
- **`ctx.episode` is never populated** by core. The lifecycle is a backend-published `phase` document.
- **`placement: "admin"` renders nowhere.** The podcaster board is an `episode`/`sidebar` slot.
- **A plugin authors no HTTP routes.** Everything derived happens in `register()` and `onSchedule`, so the
  tick-off board is eventually consistent by construction.
- **`DocStore` throws `UnsupportedOperationException` on the `USER` scope, reads included.** Fan cards are
  written by the browser and read back only via `queryAcrossUsers`.
- **`queryAcrossUsers` yields a bare `UUID`**; since 0.13.0 `ctx.users` turns it into a name and avatar.
  There are no host cards any more — everyone plays as themselves and a podcaster features some of them.
- **No browser can read another person's partition.** Anything anyone else must see — the candidate list,
  the leaderboard, a featured card — has to be copied into the episode scope by the tick first.
- **`SchemaStore.select` adds no `ORDER BY` unless a `Criteria` asks for one**, so row order guarantees
  nothing. Anything positional (a bingo line) must store its position, never infer it from row order.
- **Never offer a control the backend will ignore.** A card is only re-read while `OPEN` (or once, for a
  latecomer with no rows), so editing must stop at the freeze. This class of bug — a control that reports
  success and changes nothing — has now appeared three times: the lock button, editing after the freeze,
  and a swallowed write rejection.
- **Every podcaster action is a request, applied on the next tick.** The client writes an intent
  (`control`, `resolution`, `showcase`); the backend derives the state. Any UI for one must read the intent
  too, or it looks broken for up to a whole interval.
- **There is no `ctx.config` on the frontend.** Anything the UI needs from plugin config (`rankBy`) has to
  be published on a document the tile already reads.
- **The leaderboard is not published before `RESOLVED`.** A board that rises while answers are ticked off
  leaks how much has come true, past the spoiler cover. The backend withholds the rows, not just the UI.
- **Resolving writes a decision for every known candidate**, including misses. That is what makes "arrived
  after the resolution" exactly "has no decision" — no timestamps — and it fixes the older ambiguity where
  never-ticked and ticked-then-unticked were indistinguishable.
- **The doc store's only query is by key prefix.** No JSON filtering, no ordering, no aggregation. That is
  why history is in schema tables.
- **No schema writes over HTTP.** The backend is the only writer of relational truth; the browser writes a
  document and the tick ingests it.
- **`ctx.progress` reads `localStorage`**, so spoiler protection is per-device and invisible to the backend.
- **`ctx.users` (0.13.0) resolves ids to a name + avatar; it never enumerates.** `null` unless the manifest
  declares `identity`. The result is **not index-aligned** — an unknown, erased or pseudonymised id is
  simply absent — so key a map on `id`. **Never persist a `displayName`**; store the id, resolve at render.
- **`ctx.notifier()` (0.14.0) may only reach users this plugin already holds `USER`-scope data for.**
  `null` unless the manifest declares `notifications`. `send` returns who actually got it — an ineligible
  recipient is dropped, not an error. `NotificationException` is checked; only `RATE_LIMITED` is
  `retryable()`, and a scheduled sender should hold the batch rather than drop it. `NotifyMessage` must
  carry `en`, and its `link` is internal-only.
- **Notification wording lives in Java, not `locales/*.json`.** A notification is written on a timer with no
  Web Component mounted, and the host has no plugin catalog to resolve a key against.
- `dev/instance.sh` computes `plugins_dir` and never passes it to `bootRun` (core bug), so `--plugins` is a
  no-op and `./plugins` is loaded either way.

## Architecture guardrails (do not violate)
- Identity (`EpisodeRef`) is separate from presentation (feed snapshot). Plugin metrics are
  non-authoritative and live only in the plugin UI.
- The host resolves scopes and decides access/filters — plugins only consume.
- Per-user data goes in the `USER` scope, **never** in a key. A key naming a user is an IDOR.
- Keys the backend computes (`phase`, `candidates`, `leaderboard`, `stats`, `notified`, `participants`,
  `showcased`) are in `data.backendOwned` and written in `register()` as well as on the schedule.
  Client-written keys (`template`, `resolution`, `control`, `showcase`) must **never** be listed there.
- A person's visibility choice lives in their own partition (`prefs`) and is enforced backend-side on every
  tick — never trusted from a podcaster's stale pick.

## Deviations from `docs/BRIEF.md` (flagged, agreed with the maintainer)
1. Lifecycle from a backend `phase` doc, not `ctx.episode.status` (impossible).
2. Resolution board in `sidebar`, not `admin` (renders nowhere).
3. Fan cards in the `USER` scope, not `card:fan:{userId}` (IDOR).
4. Storage is doc **and** schema, for cross-episode statistics and recall.
5. No host cards and no typed-in names: everyone plays as themselves, resolved through `ctx.users` at
   render (0.13.0). A podcaster features cards instead, gated on each person's own choice.

## The one rule the design rests on
A person's write to their own partition **cannot be refused** — that is what makes it private. Integrity
comes from the backend freezing entries into the schema at `LOCKED`: after that the row is the record and
the document is a scratchpad nothing reads. Scores keep updating past the freeze because the podcaster is
still ticking off answers — what freezes is what a card *says*, never what it is worth.

## Dev loop
```
./build.sh && cp -r dist/* ~/mosaicast/mosaicast-core/plugins/bingo/
cd ~/mosaicast/mosaicast-core && dev/instance.sh up        # :8081, disposable, seeded sample feed
```
Plugins load once at startup — a jar or manifest change needs a restart; the frontend bundle is `no-cache`
and only needs a reload. If the tile is missing, the reason is in `/admin/logs` (drop the level to INFO).

## Keep docs current
- **README.md and this CLAUDE.md** are repo-local and your job.
- **ARCHITECTURE.md and BRIEF.md are READ-ONLY specs** — flag deviations, don't edit them.
- Keep CLAUDE.md slim (< ~200 lines).

## Plugin-dev skill (check before building)
Build this repo with the shared **writing-a-mosaicast-plugin** skill (`mosaicast-skills` marketplace).
Available -> use it. Not available -> pause, say how to install it (CONTRIBUTING -> "Recommended skill"),
and proceed without it only if the user confirms.

## When unsure
Ask, or note the assumption visibly, instead of silently diverging from ARCHITECTURE.md.
