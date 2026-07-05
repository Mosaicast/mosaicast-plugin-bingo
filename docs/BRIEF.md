# Brief: mosaicast-plugin-bingo

> Prerequisite: `docs/ARCHITECTURE.md` §4.3 (PLANNED lifecycle), §7 (plugin contract). Depends **only** on the SDK.
> Episode-scope plugin. Storage: the generic **doc store** (`storage: "doc"`), no own tables.

## Concept
Per episode there are **multiple bingo cards, each with an author**. Every host makes **their own** bingo, fans fill in their own. The lifecycle is tied to the episode status: **PLANNED = prediction phase, PUBLISHED = resolution.** Anonymous users see the host cards; only logged-in users fill in.

## Data model (in the doc store, scope=EPISODE)
- `template` — the template (grid size, default 3×3, variable; free center).
- `card:host:{userId}` / `card:fan:{userId}` — one card per author, with `authorType ∈ {host,fan}`, entries, position.
- `resolution` — **one shared truth list**: all entries of **all** cards, fuzzy-deduplicated, each true/false.
- (Listening progress is **not** stored here — it comes from core via `ctx.progress`, ARCHITECTURE §6.5.)

## Behavior
- **Distinguish multiple hosts:** host cards are labeled prominently (tabs "Alex / Jonas / Your bingo"), each with its own hit count. `authorType` separates host/fan purely for display.
- **Resolving (podcaster):** the backend loads `query(EPISODE, "card:")`, groups equal entries **fuzzily** (threshold from `config.fuzzyThreshold`), so "Alex says 'damn it'" appears only **once** to tick off. Every card (host and fan) scores against the same `resolution`.
- **Prediction mode (PLANNED):** cards show unresolved cells, CTA "fill in your bingo". Latecomers can still fill in.
- **Spoiler protection:** hide cards of unheard episodes via **`ctx.progress`** (core listening-progress service).
- **Leaderboard:** host vs host (cumulative); top fans/global = future.

## Slots (manifest)
- `episode / main` — fan card + host card tabs (`visibleTo: anonymous` to read, filling only when logged in).
- `episode / admin` — the tick-off/resolution board (`visibleTo: podcaster`).
- `episode / card` — compact badge on the feed card ("bingo open" / "x/8 hit").
- `episode` suffices; the plugin reads `ctx.episode.status` for prediction vs. resolution mode.

## Definition of Done
A podcaster creates a 3×3 template, multiple hosts + fans fill their own cards, resolution groups equal entries fuzzily, every card scores, host tabs + leaderboard visible, prediction mode when PLANNED, spoiler protection works. All in the doc store.

UI strings via the SDK i18n helper (`locales/en.json` + `de.json`).

**Tests (§13.5):** backend unit tests against the Java test kit (FakePluginContext) — especially the fuzzy resolution and per-card scoring against the shared `resolution`; a frontend test with `makeMockCtx` for the tab / prediction-vs-resolution rendering.

## SDK & license
- Depends **only** on the SDK; consume via `mavenLocal()`/`includeBuild` and `npm link` (ARCHITECTURE §3.5). **Exact signatures from the SDK Javadoc/TSDoc, don't guess.**
- **License: AGPLv3** (official feature plugin). SPDX headers in source files. Take `CONTRIBUTING.md` + DCO workflow from the templates.
