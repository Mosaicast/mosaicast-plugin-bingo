<!--
SPDX-License-Identifier: AGPL-3.0-or-later
SPDX-FileCopyrightText: 2026 The Mosaicast Authors
-->

# Importing past bingos: `mosaicast-bingo/1`

Bingos played before a site ran Mosaicast come in through `scripts/bingo-import.mjs`. Once imported, they
are resolved bingos like any played here: scored, ranked, and part of the site page's history and charts.
The same format is what the plugin hands over for a person's own data export
(core 0.8.0: `plugins/bingo/bingo.json` in the person's ZIP), so an export can be imported again.

## The file

```json
{
  "format": "mosaicast-bingo/1",
  "players": {
    "A": { "name": "Max" },
    "B": { "name": "Alex" }
  },
  "bingos": [
    {
      "episode": { "season": 3, "episode": 7 },
      "title": "The Red Wedding bingo",
      "size": 3,
      "freeCentre": false,
      "cards": [
        {
          "player": "A",
          "squares": [
            { "text": "Tyrion drinks", "hit": true },
            { "text": "Someone sings", "hit": false },
            { "text": "", "hit": false }
          ]
        },
        { "player": "B", "ranked": false, "squares": [ … ] }
      ]
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `format` | yes | Always `mosaicast-bingo/1`. Any other value stops the script before anything else. |
| `players` | no | The file's player keys, with a `name` for **your** convenience: names are printed next to the claim codes and never leave your machine. If present, every card's `player` must be one of its keys. |
| `bingos[].episode` | yes | `{ "slug": "…" }`, or `{ "season": n, "episode": n }` (matched against the site's episodes; give the slug when two feeds share the numbers). |
| `bingos[].title` | no | The bingo's own name. |
| `bingos[].size` | yes | The grid's edge: 3, 4 or 5. |
| `bingos[].freeCentre` | yes | Whether the middle square was a gift. Only odd grids have one. |
| `bingos[].onExisting` | no | `"merge"` to add these cards to a bingo the episode already has (see below). |
| `cards[].player` | yes | A key of your choosing. It is only a label: `A` and `B` are fine. |
| `cards[].ranked` | no | `false` for someone who played after the deadline back then. Default `true`. |
| `cards[].squares` | yes | Every square in reading order, left to right, top to bottom, **skipping the free middle**. Exactly `size² − 1` squares with a free centre, `size²` without. An empty square is `{ "text": "" }`. |
| `squares[].hit` | no | Whether it came true. Default `false`. |

**The grid is stated, never guessed.** A 3x3 with a free middle has 8 squares, and the free middle counts
as a hit, exactly as it does live. A 3x3 without one has 9 squares, and the 5th is the middle.

**One truth per spelling.** The same words, ignoring case and punctuation, cannot be true on one card and
false on another in the same bingo. Spellings the plugin would group together but that were judged
differently are kept apart, so every card scores exactly what the file says, and a later change to the
matching threshold cannot change history.

## Running it

You need a podcaster's personal access token (account page → tokens) in `MC_TOKEN`.

```bash
export MC_TOKEN=mcp_…
node scripts/bingo-import.mjs --file past.json --url https://your.site          # dry run: report only
node scripts/bingo-import.mjs --file past.json --url https://your.site --apply  # import, then wait for the result
```

The **dry run** checks the whole file and lists every problem with its location, for example
`bingos[3].cards[1].squares: 7 entries, a 3x3 needs 9`. It matches every bingo to its episode and says
which episodes already have a bingo. Broken JSON or a wrong `format` stops it immediately.

**`--apply`** refuses while anything is invalid. With `--skip-invalid` it imports the valid bingos and
lists the rest. It never prompts, so a run can be repeated exactly. Each bingo goes to the plugin's
backend, which validates it again and takes it in on its next pass. The script waits for that pass and
prints what became of each bingo.

Episodes that already have a bingo are **skipped**. With `--existing=merge` (or `"onExisting": "merge"`
on one bingo), the imported cards join that bingo, but only once it is resolved, and never by changing
how something already decided there was judged. Nothing is ever replaced.

## Players and claim codes

The script gives every player key a **pseudonym** and a **claim code**. Both are kept in
`past.players.json` next to your file. **Keep that file secret** (it is git-ignored): a re-run reuses
it, so the same key stays the same player.

An imported player is **counted, never named**, until someone claims them: they appear in places,
averages and hit rates, like a player who chose not to be on the leaderboard. To take their cards over,
the person signs in, opens `/p/bingo/`, and enters their code under *Played before this site existed?*.
On the next update the cards become theirs, and their own leaderboard choice applies to them.
- A code works once.
- If the person already played that episode here, their own card stays the record and the imported one
  stays anonymous; the box says how many were skipped.
- Bingos imported later under the same player follow the person who claimed them.

If a code reached the wrong person:

```bash
node scripts/bingo-import.mjs unclaim --file past.json --player A --url https://your.site
```

On the next update, the cards go back to the pseudonym, the old code stops working, and the script prints
a new one.

Nobody is ever attached to an account by somebody else: the backend refuses real account ids in an
import, so an account is linked only by its own claim.
