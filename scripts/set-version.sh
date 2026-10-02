#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 The Mosaicast Authors
#
# Sets the plugin's own version in the three files that carry it.
#
# **Not the same version as `platformApi`.** That one is the host contract the backend compiled against, it
# lives in four other places, and it is bumped only when the SDK moves. This is the plugin's own SemVer, and
# nothing in a plugin repo keeps its three copies in step — which is exactly the kind of drift that produces
# a release whose tag, manifest and jar disagree about what they are. `ci.yml` fails the build if they do,
# and this is the script that stops that from happening in the first place.
#
#   scripts/set-version.sh 0.2.0
#
# Then: ./build.sh, run both test suites, commit, tag `v0.2.0`, and publish the GitHub release — the release
# workflow refuses a tag that disagrees with the manifest, so a bump forgotten here is caught there too,
# just much later.
set -euo pipefail

cd "$(dirname "$0")/.."

version="${1:-}"
if [ -z "$version" ]; then
  echo "usage: scripts/set-version.sh <x.y.z>" >&2
  echo "current: $(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' plugin.json | head -1)" >&2
  exit 2
fi

# SemVer, and deliberately without a `v`: the tag carries the `v`, the manifest never does, and accepting
# both here is how one of them ends up with it.
if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "not a SemVer version (and drop any leading 'v'): $version" >&2
  exit 2
fi

# Each pattern is anchored to the one line that matters. `plugin.json` and `package.json` both contain other
# "version"-ish keys, so match the first top-level one only.
sed -i "0,/\"version\"/s/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"version\": \"$version\"/" plugin.json
sed -i "0,/\"version\"/s/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"version\": \"$version\"/" frontend/package.json
sed -i "s/^version = \".*\"/version = \"$version\"/" backend/build.gradle.kts

echo "plugin.json                 $(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' plugin.json | head -1)"
echo "frontend/package.json       $(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' frontend/package.json | head -1)"
echo "backend/build.gradle.kts    $(sed -n 's/^version = "\(.*\)"/\1/p' backend/build.gradle.kts)"
echo
echo "next: add a CHANGELOG.md entry, ./build.sh, run both suites, commit -s, tag v$version"
