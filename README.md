# mosaicast-plugin-bingo

> Episode plugin: per-host bingos, prediction/resolution lifecycle (PLANNED/PUBLISHED), leaderboard.

Part of **[Mosaicast](https://github.com/mosaicast)** — an extensible website platform for podcasts. Status: **v1 in development**.

## What is this?
See `docs/ARCHITECTURE.md` for the big picture and `docs/BRIEF.md` for this repo's scope.

## Build & test
```bash
./build.sh        # -> dist/
cd backend && ./gradlew test  ;  cd ../frontend && npm test
```

## Build & install
`./build.sh` -> `dist/` -> copy to `$MOSAICAST_PLUGINS_DIR`, restart core.
Depends ONLY on the SDK; data in the generic doc store.

## Contributing
Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). In short: `git commit -s` (DCO, required), SPDX header in new files, add tests.

## License
**GNU Affero General Public License v3.0 or later** — see [`LICENSE`](LICENSE). Header per source file:
```
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors
```

## Name & trademark
"Mosaicast" and the logo denote the official project. Please rename forks.
