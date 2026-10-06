# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Note that the plugin's own version is **not** `platformApi` — that one is the host contract the backend
compiles against, and it moves only when the SDK does. `scripts/set-version.sh` bumps the plugin's version
in the three files that carry it.

## [Unreleased]

Built against **`platformApi` 0.18.0**, so it needs **core 0.7.7 or newer**. Core matches that version on
`major.minor` exactly: core 0.7.6 and older reject this build at load, and core 0.7.7 rejects the 0.6.x
build.

### Added
- **The bingo page, `/p/bingo/`**, from a *Bingo* menu entry. It shows the site standings (computed
  before, but never drawn), every bingo on an episode everyone may know about, one bingo's board and
  recap, and a player's shared result. Unknown subpaths, a quiet episode's bingo and an unpublished
  result are real 404s (`PageRouteProvider`).
- **Share cards and a Share button.** Every page has OpenGraph tags in the site's language
  (`ShareMetadataProvider`). They give counts and scores only, never what was predicted or came true.
  The button shares the player's own result once the published board carries it, and the bingo otherwise.
- **Split and merge in the resolve dialog.** A podcaster sees the spellings grouped into each candidate,
  can split one off or merge a candidate into another, and is warned when the merged candidates were
  decided differently. The pins sit on a client-written `grouping` document, apply on the next pass,
  also to frozen cards, and show as pending until they land.
- **Completed lines are marked on a scored card.** A soft band in the accent colour runs behind each
  finished row, column and diagonal, under the text. It is measured from the squares themselves, so it
  fits any width and grid size, and it draws in once (not with reduced motion). A card being written
  has none.
- **A recap** (`recap`, backend-owned) once a bingo is resolved: the most predicted thing, the rarest
  hit, the biggest miss, the average card. It's behind the spoiler cover.
- **Suggestions**: predictions at least two different people made, site-wide (`suggestions`,
  backend-owned). They're offered as chips in the card editor, behind a *Show suggestions* switch saved
  to the player's own `prefs`.
- **Card checks while typing**, in the browser with no request: a repeated square blocks saving, and a
  near-duplicate (by the published `fuzzyThreshold`) gets a hint. `shared/fuzzy-vectors.json` holds the
  Java and TypeScript comparison rules to the same answers.
- **A badge that speaks to the viewer**: their own score, "Your card is in" / "Fill in your card",
  "Predict before it airs" on an upcoming episode, and "not announced yet" for a podcaster's quiet bingo.
  One listing of the viewer's own partition serves every badge on a page.
- **Charts and records for past bingos** on `/p/bingo/`, in the stats plugin's design. There is a line
  per player across the season (per episode, running total or place; season pills; table view), plus
  cards per bingo, how predictable each episode was, how cards score, and records. They come from a new
  backend-owned site document, `history`: resolved and public bingos only, and named series only for
  listed players. A bingo's own page shows how its cards scored.
- **Importing past bingos** with `scripts/bingo-import.mjs` from a `mosaicast-bingo/1` file
  (`docs/import-format.md`). It does a dry run first, reports every problem with its location, and skips
  episodes that already have a bingo unless asked to merge. The backend takes each bingo in whole, and
  every card scores exactly as the file marks it. Players get **claim codes** instead of being attached
  to accounts: until claimed they count without a name, and the person enters their code on `/p/bingo/`
  to take the cards over. A code can be revoked and reissued.
- `exportUser` hands over a person's own cards as `mosaicast-bingo/1`, ready for core's data export
  (core#263).
- Season pills name the feed when the history spans more than one.
- **Rankings per season, and per card.** The all-time standings at the top gain a Total / Per card
  switch. The history section adds a second ranking that follows the season pill, and the records follow
  it too. Per card needs `minCardsPerCard` cards (a new setting, 3 by default); players below it are
  counted, never named.
- `docs/ROADMAP.md`: deferred ideas and what each one is waiting on.
- **A bingo for an episode that has not aired, end to end** (core 0.7.7's planned episodes). A podcaster
  prepares the bingo while the planned episode is quiet, players fill in cards once it is announced, and
  its release closes predictions. Bingo used to infer a release from the feed's publication date, which a
  planned episode does not have; it now reads the episode's phase (`DisplaySnapshot.phase()`), as the
  contract asks, and listens for the release itself (`onEpisodeReleased`), so predictions close at the
  release instead of up to one ingest interval later — while a quick listener could still rewrite a card
  with the episode playing. The event is best effort; every tick still reconciles by phase. The release pass
  is a full pass under the same lock as the tick, so the last cards saved before it are ranked and no card is
  frozen twice.
- **Nothing derived from a quiet episode is published.** Its own documents are hidden by the host; the
  public site standings now leave its cards out, as well as the rows of a cancelled plan, whose documents
  core deletes but whose rows it cannot know about. A resolve notification names and links the episode,
  so for a quiet one it waits until the episode is announced.

### Changed
- `BingoPlugin` is split into `BingoDocs`, `BingoLifecycle`, `BingoRecord`, `BingoPublish` and
  `BingoPages`, and the tile into smaller components. There's no behaviour change from the split.
- **`platformApi` 0.18.0** in all four places (`plugin.json`, `plugin-api`, `plugin-testkit`,
  `@mosaicast/plugin-sdk`), and **PF4J 3.16.0**, which `plugin-api` depends on since SDK 0.16.2 and core
  0.7.5 loads plugins with.
- **A withdrawn episode keeps its bingo locked.** Read by phase, withdrawn still counts as released; going
  by the publication date had the same effect only by accident.
- The dev loop uses core's **named instances** (`dev/instance.sh --name bingo up --plugin-dir dist`, 0.7.5),
  isolated from every other session's, instead of copying into core's shared `./plugins` and the fixed
  `:8081` default instance — and `restart`, which takes a new build or core and keeps the database (0.7.6).
  README and CLAUDE.md say how.
- `docs/ARCHITECTURE.md` synced from core 0.7.7 (`baf12bc`, not tagged yet): planned, quiet and announced
  episodes and the derived release phase (§4.3), `onEpisodeReleased`, `ctx.episode` filled; and from 0.7.6
  a remembered miss lasting 30 s (§7.6), season and feed on the display snapshot, ZIP uploads, private blob
  floors and the live filter state.

### Fixed
- **A claimed card showed empty on its episode**, and the tile offered a late card that would have been
  ignored. The tile draws your card from your own partition, which only your browser can write. The
  backend now hands the claimed cards over sealed with the claim code, and your browser copies them in
  (from the bingo page, or from the episode itself).
- **Your own card is no longer behind the spoiler cover.** Featured cards and the recap still are, on an
  episode this device hasn't heard.
- **A late spelling could orphan a decision.** A group is named after its first member in sorted order,
  so "alex says damn" arriving after "alex says damn it" was decided renamed the group. Decided groups
  are now seeded before matching.
- **Text written to a card after the freeze reached the public candidate list** and featured cards.
  Both are now built from the frozen record.
- **Site standings counted unresolved bingos**, which leaked tick-off progress the episode's board
  withholds. They now count resolved bingos only.
- **A reader who never played is no longer placed on the leaderboard.** The tile works out the reader's own
  place from their card, so someone past the published cap or opted out still sees where they came. It did
  that from the card *form*, which for someone with no card is a blank grid — so a podcaster who resolved
  without playing was drawn in last place, scoring the free middle square. Only a card that was handed in
  is placed now. Found in a live roundtrip on core 0.7.5.
- **Your own row carries your name.** A row the board never published — opted out, or past the cap — was
  never resolved through `ctx.users`, so it read *Former listener* next to *You*. The signed-in reader's own
  `ctx.user` now fills in whenever the directory gave no answer; nothing is stored.

### Performance
- One cross-user read of every card per tick, not one per episode. An unchanged open card and an unchanged
  score are no longer rewritten. The site roll-up runs only when its inputs changed, or hourly.
- Fuzzy grouping normalises each entry once and skips comparisons that can't reach the threshold. A test
  holds the results identical to the plain definition.

### Known issue
- Core serves the schema tables under `data.readableBy` (anonymous here), so raw rows are public. A
  separate floor is proposed in core#261 / sdk#99. The frontend never reads `ctx.schema`.

### Not adopted
- **`ctx.docs.getMany` in place of `readEpisode`**, although every host of 0.17.0 forgets a miss after 30 s
  and on every navigation (core 0.7.5, core#237). The re-read after a podcaster's own action lands inside
  those 30 s, where a `phase` the tick wrote meanwhile would stay hidden. The uncached batch read costs the
  same one request.
- **`ctx.episode.phase` on the frontend (0.18.0).** It is the episode's phase; the tile shows the bingo's,
  which the backend derives from that and the podcaster's intent. The page itself already tells a podcaster
  that a quiet episode is invisible to everyone else. **`blobs.readableBy`**: no `blobs` block.
- **`DisplaySnapshot.season` / `Scope.season` (0.17.0).** The only per-season candidate is the site `stats`
  document, and nothing renders it yet; splitting data nobody draws is not a feature. **`ctx.filter`** (live
  since core 0.7.6): the tile sits on one episode and the badge has nothing to filter. **ZIP uploads**: no
  `blobs` block.

## [0.6.0] — a bingo that shows up without a reload, and a cross-user read it has to declare

Built against **`platformApi` 0.16.1**, so it needs **core 0.7.4 or newer**. Core matches that version on
`major.minor` exactly, and the patch floats: core 0.7.4 (which pins 0.16.0) loads this build, core 0.7.4
rejects the 0.5.x build at load, and core 0.7.2 rejects this one. SDK 0.16.1 changes only `ctx.sanitize`,
which this plugin does not use; the pins follow it so all four `platformApi` anchors stay one literal.

### Fixed
- **Locking before the backend's first pass no longer disqualifies every card.** A bingo with no phase
  document yet was treated as having always been in the phase that pass applied, so when a podcaster created
  a bingo, players filled in cards and the podcaster locked it inside one ingest interval, every card was
  frozen as a latecomer and listed under "played late" — while each player's tile had said "Predictions
  open" throughout. Found in a real browser; an absent phase now counts as `OPEN`, which is what the tile
  shows and what the backend itself suggests on first sight.
- **A bingo, its phase and its leaderboard appear without a full reload.** Since core 0.7.3 the host's doc
  client remembers every "not set" for the life of the page. Every episode document this plugin reads can
  appear after the first visit — the template when a podcaster creates the bingo, `phase`, `candidates`,
  `participants`, `showcased` and the leaderboard when the backend's tick writes them — so, measured in a
  real browser on core 0.7.4, a fan who had opened an episode before its bingo existed was still told
  "There is no bingo for this episode yet" after navigating away and back, with no request made at all, and
  the feed badge stayed blank. The tile and the badge now read their episode through the host's batch
  endpoint via `ctx.api`, which is uncached: one request for the tile's nine documents and one per badge,
  where there were nine and three. The viewer's own card and preferences still go through `ctx.docs.get`,
  whose remembered misses are right for a partition only this client writes. Reported as core#237.

### Changed
- **The cross-user read is declared.** `DocStore.queryAcrossUsers` is gone in 0.16.0; the manifest declares
  `data.readsAllUsers` and the tick reads every player's card through `ctx.allUsers()`. The admin plugin page
  now tells an operator that bingo reads every user's data for this plugin. Registering without the
  declaration fails loudly, with the reason in `/admin/logs`, rather than running a game that sees no cards.
- **Numeric settings carry bounds the host enforces**: `ingestIntervalSeconds` 10–3600, `fuzzyThreshold`
  0–1 in steps of 0.01, `archiveAfterDays` 1–3650. The host refuses an out-of-range save with a 400 and treats
  an older stored value outside them as unset. The plugin's own floor at one second is removed; **an interval
  saved below 10 before this release now counts as unset and falls back to 60**.
- **Text, focus rings and state borders use `--mc-accent-text`**, the accent clamped to WCAG AA.
  `--mc-accent` stays on fills. A pale accent seed made hit cells and focus rings unreadable.
- A podcaster now sees `rankBy` as "hidden — only an admin can see and change this" instead of a disabled
  dropdown that showed its first option whatever the setting was (core#156, fixed in core 0.7.4).
- `docs/ARCHITECTURE.md` synced from core `v0.7.4`: platformApi 0.16.0, `readsAllUsers` and `allUsers()`,
  `ctx.sanitize`, `--mc-accent-text`, config bounds, the 204 for an absent document and the batch read.

### Not adopted
- `ctx.sanitize` / `descriptionText`: the plugin renders no feed HTML. `consent.categoryLabels`: it declares
  no consent services. `ctx.docs.getMany`: it feeds the same remembered misses, and is guaranteed to batch,
  not to be fresh.

## [0.5.0] — settings that say what they are, and a tile that survives a new context

Built against **`platformApi` 0.15.0**, so it needs **core 0.7.2 or newer**. Core matches that version on
`major.minor` exactly: an older core rejects this build at load, and a 0.4.x build is rejected by 0.7.2.

### Added
- **Every setting has a translated name and explanation.** The generated admin form showed operators the raw
  key — `ingestIntervalSeconds (podcaster)` — and nothing about what it does or what unit it is in. All six
  fields now declare a `label` and a `description` in English and German, which core 0.7.2 renders in place
  of the key, in the language the operator is reading.

### Changed
- **A saved `ingestIntervalSeconds` applies without a restart.** The tick is registered with the new
  `onSchedule(Supplier<Duration>, …)` overload, which the host re-reads before every tick, so a change takes
  effect within one old interval. The old `Duration` form captured the value once at load: the admin form
  confirmed the save while the plugin kept its previous cadence until the host restarted.
- **The tile and the feed badge survive a new context.** Both elements return a `MosaicastHandle`, so a
  reassigned `ctx` re-renders the same React root instead of tearing the element down. A half-typed card, an
  open resolve or featuring dialog and any in-flight read are kept, and hooks now depend on the values they
  actually read rather than on the context object as a whole.
- **The feed badge no longer keeps a module-level read cache.** It was added because every `ctx`
  reassignment rebuilt each badge and re-read its episode. With the elements updating in place and core
  0.7.2 no longer churning the context, measured in a real browser: a six-episode feed page makes 18
  reads with or without it, and switching the UI language adds none — so it was removed.
- **Podcasters can open the settings page** (core 0.7.2) and edit every field marked `podcaster`; `rankBy`
  stays with the admin and shows to them disabled. Only the documentation changed here — the manifest
  already delegated those fields.
- `docs/ARCHITECTURE.md` synced from core `v0.7.2`: display names, avatars and what a plugin sees of a user
  (§8.6–8.8), notifications (§17), and config `options`, `label` and `description` (§7.2).

### Fixed
- **A card saved just before the lock is no longer disqualified.** The tick that closed predictions derived
  the new phase first and then ingested under it, so any card that pass was seeing for the first time —
  anything saved during the last interval, up to a whole `ingestIntervalSeconds`, while the tile still said
  predictions were open — was frozen as a latecomer and left off the board. Ingest now runs under the phase
  the cards were written in, and predictions count as open if they were open at either end of the interval,
  which also keeps *Reopen predictions* working.
- **Entries that disagree about a number are no longer merged.** Similarity was pure edit distance, so
  "3 sponsor reads" and "5 sponsor reads" were one character apart out of fifteen and became a single thing
  to tick off — one tick then scored both. A number is the whole content of such a guess, so two entries
  whose digits differ are now held apart outright. A digit on one side only ("episode 1" against
  "episode one") is still left to edit distance.
- **"on n cards" counts cards.** It was showing how many entries had merged into a candidate, which is a
  larger number whenever one person wrote the same prediction twice. The candidate list is ordered by that
  count too, so the order agrees with the number beside each row.
- **Opting out of the leaderboard no longer removes you from the count.** The headcount shown before a
  bingo resolves is everyone who played, so it agrees with the featured-card picker on the same tile; and
  the score tally counts every card, so a reader with no published row — which is precisely what opting out
  means — can still be placed. Their own position is now drawn on their own screen. No extra name is
  published either way.
- **`defaultGridSize` does something.** It was declared in the manifest and read by nothing. The tick now
  settles a template that never stated a size, writing the configured default into the document so the
  browser — which has no `ctx.config` — reads the same number the backend scored with.
- **A 4x4 is no longer created claiming a free middle square.** Switching the grid to an even size disabled
  the checkbox but left its state behind, and that state was submitted.
- **A feed listing no longer fires 126 requests.** Each episode badge read all nine episode documents plus
  the viewer's own card, their preferences and the tag vocabulary — nearly all of it 404 and none of it
  drawn — and refetched on every host re-render. A badge now reads the three documents it draws from, once
  per episode, shared across mounts: 126 requests down to 19 on the same page.
- **A locked bingo no longer announces itself as "No bingo"** in the feed badge. Each phase says the true
  thing about itself.
- **A featured card is no longer drawn twice to its own author.** Being featured is something other people
  see; the owner already has their own tab, which is the one carrying the editor and the visibility
  choices, so the featured copy of it is now left out for them alone.
- **Entries sit in the middle of their square while being typed.** A textarea starts its text at the top,
  so an editable square read as top-aligned where the same square read-only was centred.
- **`rankBy` and `defaultGridSize` are dropdowns, not text boxes.** Both declare their values in the
  manifest, so the admin form offers exactly the ones that work and refuses the rest — a typo used to
  validate, store, and then fall back in silence. Needs core 0.7.2.
- Three German strings wrote their umlauts as digraphs (*Aufgeloest*, *endgueltig*, *Fuelle*), and the grid
  hint asserted that an odd grid gives its middle square away when the default is that it does not.

## [0.4.0] — lines, and a resolving dialog

### Added
- **Completed rows, columns and diagonals count.** A grid has `2n+2` lines. The plugin config `rankBy`
  decides whether lines or individual fields order the leaderboard; the other is always the tiebreaker.
  Default is `lines` — bingo as people expect it.
- **The free middle square is now a choice per bingo**, made when it is created and **off by default** —
  every square is the player's to write unless the bingo says otherwise. Absent in a template means off
  too. It is only worth anything under line scoring, where on a 3x3 the middle sits on four of the eight
  lines; under field scoring it adds the same constant to everybody and moves nobody.
- **Resolving is a dialog on the bingo itself.** One button whose label follows the phase, and after the
  bingo is resolved it becomes *Catch up (n)* for terms that arrived since.
- Featuring cards moved into a dialog of its own, reachable from the same row.

### Changed
- **The leaderboard appears only once the bingo is resolved.** The backend publishes no rows before then,
  and says how many are taking part instead.
- **A published board is bounded**: at most 50 rows in the document, the first five on screen, plus the
  reader's own row with its real position, plus "and n more". Scoring itself is not capped — every card
  gets a row, and the board carries a tally of how many share each score so a reader past the cap can
  still be placed exactly. The tally costs an entry per distinct score rather than per player, and names
  nobody.
- The podcaster's `sidebar` slot is gone; `bingo-episode-board` no longer exists.
- Scores read as `lines/ofLines lines, fields/cells fields` rather than one bare number, and the card tabs
  and the feed badge lead with **whichever quantity the site ranks on** — leading with the other one would
  tell people to optimise for something that decides nothing. The setting travels on the leaderboard
  document, since the frontend has no `ctx.config`.

### Fixed
- **A card could be edited after the freeze, and the edit did nothing.** The tile offered editing in every
  phase but `ARCHIVED`, while the backend only ever re-reads a card while predictions are open. Typing and
  saving after the lock reported success and changed nothing — the same dead control the lock button was.
  Editing now stops when the card freezes, and the tile says so.
- **A latecomer's card is one-shot and now says so.** It is ingested once and never re-read, so the button
  reads *Hand in my bingo* and warns that it cannot be changed afterwards.
- **The visibility switches no longer freeze with the card.** They are a standing choice about the person,
  not part of the card, so somebody whose card is frozen can still take themselves off the leaderboard.
- **Lifecycle buttons looked dead.** Pressing *Lock predictions* wrote the intent immediately and correctly,
  but the phase it produces is derived on the backend's next pass — up to a whole `ingestIntervalSeconds`
  later. Nothing on screen changed in between and the button kept its old label, so it read as broken and
  invited pressing again. The tile now reads the intent alongside the derived phase and says the change is
  pending, and the button that would ask for it again is disabled while it is.
- A failed phase write rejected into nothing, so a refusal looked exactly like the wait above.
- **A bingo could never score zero.** The free centre was forced on for every odd grid, was not editable,
  and counted as a permanent hit — so a fresh 3x3 showed 1/9 for everyone before anything was resolved.
- **The leaderboard was a spoiler channel.** It rendered outside the spoiler cover and updated live while
  the answers were being ticked off, so anyone could read off how much had already come true.
- **"Never decided" and "decided as a miss" were the same thing** to the backend, so a term that appeared
  after the resolution silently counted as a miss. Resolving now writes a decision for every candidate it
  knew about, which is also what makes "arrived since" exact without any timestamps.
- Entries had no grid position, and rows come back from the host in no guaranteed order — lines could not
  have been counted reliably at all. The position is now stored with the row.

## [0.3.0] — everyone plays as themselves

### Added
- **A way to create a bingo.** A podcaster on an episode without one now gets a panel: pick a grid (3x3,
  4x4, 5x5), name it, create. Until now the template could only be written by hand through the doc-store
  API, which is how every screenshot of this plugin got made.
- **Featured cards.** A podcaster picks whose cards get the prominent tabs. Because no browser can read
  another person's partition, the backend publishes the candidate list (ids only) for the picker and copies
  the chosen cards out so anyone can read them.
- **Two visibility switches, remembered.** "Show me on the leaderboard" and "My card may be featured" live
  in each person's own partition, are prefilled from their last save, and are not asked per episode.

### Changed
- **Host persona cards are gone.** Everyone — hosts included — fills in a normal card as themselves, and
  every name and avatar comes from the host's identity. `card:host:*` and the podcaster-typed label no
  longer exist, and the schema stores no name at all. Podcaster-typed personas only ever existed because
  before platformApi 0.13.0 a backend could not turn a user id into anything renderable.
- Cumulative standings are across all listed players rather than host-versus-host.
- The grid no longer repeats a placeholder in every empty square; one hint sits above it.

### Notes on the rules
- An opt-out is **enforced by the backend on every tick**, not trusted from the podcaster's pick: a
  selection made before someone changed their mind stops publishing them, because only the backend can see
  both the pick and the preference.
- Opting out of the leaderboard is a choice about what other people see. Someone who opts out is still
  scored, still keeps their rows, still sees their own score, and is still told when the bingo resolves.
- Both switches default to yes for someone who has never touched them. They sit next to the save button,
  and a leaderboard that defaults to empty is a leaderboard nobody ever sees.

## [0.2.0] — real people, and telling them

Built against **platformApi 0.14.0** (core 0.7.x). Requires it: a 0.12.0 manifest is rejected outright.

### Added
- **Players are drawn from the host's own identity, not from what they typed.** The leaderboard resolves
  each fan's UUID through `ctx.users` at render time and shows their real display name and avatar.
- **A notification when a bingo resolves.** Everyone who filled in a card is told, in every language this
  plugin speaks, with a link back to the episode — and ranked players and latecomers get different
  wording, because "see how you did" and "your card was not ranked" are not the same news.
- Host rows now carry a visible `Host` marker.

### Changed
- **A fan no longer supplies a name at all**, which closes an impersonation gap: previously a fan could
  label their card "Alex" and sit on the leaderboard indistinguishable from the host of that name. Host
  names remain podcaster-authored show personas, which is what they always were.
- **No display name is persisted for a fan.** A copied name outlives the rename meant to shed it and the
  erasure meant to end it, and core cannot reach into a plugin's own tables to fix either. Rows keep the
  id; the person is drawn at render.
- German UI strings now use real umlauts instead of `ue`/`ae`/`oe` transliterations.

### Fixed
- **A card could be edited after the freeze, and the edit did nothing.** The tile offered editing in every
  phase but `ARCHIVED`, while the backend only ever re-reads a card while predictions are open. Typing and
  saving after the lock reported success and changed nothing — the same dead control the lock button was.
  Editing now stops when the card freezes, and the tile says so.
- **A latecomer's card is one-shot and now says so.** It is ingested once and never re-read, so the button
  reads *Hand in my bingo* and warns that it cannot be changed afterwards.
- **The visibility switches no longer freeze with the card.** They are a standing choice about the person,
  not part of the card, so somebody whose card is frozen can still take themselves off the leaderboard.
- **Lifecycle buttons looked dead.** Pressing *Lock predictions* wrote the intent immediately and correctly,
  but the phase it produces is derived on the backend's next pass — up to a whole `ingestIntervalSeconds`
  later. Nothing on screen changed in between and the button kept its old label, so it read as broken and
  invited pressing again. The tile now reads the intent alongside the derived phase and says the change is
  pending, and the button that would ask for it again is disabled while it is.
- A failed phase write rejected into nothing, so a refusal looked exactly like the wait above.
- A leaderboard mixing a host card and a fan card threw while sorting and silently published nothing for
  that episode — the tick logged a warning and moved on, which is exactly how it went unnoticed.

### Notes
- `identity` and `notifications` are opt-in manifest blocks. Without them `ctx.users` and `ctx.notifier()`
  are `null` and the plugin degrades to placeholders and silence rather than failing.
- Nobody is told twice: the backend records who it has told, per episode, in a backend-owned document.
  Tracking people rather than "did we announce yet" is also what lets a latecomer be told on a later tick.

## [0.1.0] — first working version

Built against **platformApi 0.12.0**.

### Added
- Per-episode bingo with a card per host and a card per fan, on tabs, each with its own hit count.
- One shared, fuzzy-deduplicated resolution list: "Alex says 'damn it'", "alex says damn it!" and
  "Alex says: Damn it" are one thing to tick off, and every card scores against the same list.
- A four-state lifecycle — `OPEN`, `LOCKED`, `RESOLVED`, `ARCHIVED` — derived from the feed and always
  overridable by the podcaster, with the tick-off board and the lifecycle control in the episode sidebar.
- Catch-up play: a card started after the lock is still scored, and shown as *played late, not ranked*.
- Schema-backed history (`entry`, `card_result`) so scores, per-entry frequency and cross-episode host
  standings are real queries rather than a growing JSON blob.
- `UserDataHandler`: account deletion cuts the identity link on a person's rows and rewrites published
  leaderboards, keeping the record of the game itself intact.
- Spoiler protection through `ctx.progress`, applied only once something has actually been resolved.
- English and German UI strings.

### Notes on the design
- Fan cards live in the `USER` scope (`data/user/me/card:<episode>`), never in a per-user key under the
  episode scope — doc keys are client input, so a key naming a user is an IDOR.
- The tick-off board is eventually consistent by construction: a v1 plugin authors no HTTP routes, so the
  grouping runs on the plugin's schedule.
- Nothing can refuse a person's write to their own partition. Integrity comes from the backend freezing
  entries into the schema at `LOCKED`; past that point the row is the record and the document is a
  scratchpad nothing reads.
