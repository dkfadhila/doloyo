#!/usr/bin/env bash
# Rebuilds public/assets from the Quaternius CC0 downloads (dev-time only; outputs are committed).
# Usage: SRC=/path/to/assets-src bash scripts/prepare-assets.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${SRC:-../assets-src}"
OUT=public/assets
TMP="$(mktemp -d)"
GT="npx --yes @gltf-transform/cli@4"
UAL1="$SRC/quaternius-ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb"
UAL2="$SRC/quaternius-ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb"
MANF="$SRC/quaternius-ual2/Universal Animation Library 2[Standard]/Female Mannequin/Unreal-Godot/Mannequin_F.glb"
mkdir -p "$OUT/characters" "$OUT/anims"

# Mannequins (mesh + skin, no animations)
node scripts/gltf-strip.mjs "$MANF"  "$OUT/characters/mannequin_f.glb" --no-anims
node scripts/gltf-strip.mjs "$UAL1"  "$OUT/characters/mannequin_m.glb" --no-anims

# Animation libraries (skeleton + clips only), keyframes resampled to drop redundant keys
node scripts/gltf-strip.mjs "$UAL1" "$TMP/ual1.glb" --anims-only
node scripts/gltf-strip.mjs "$UAL2" "$TMP/ual2.glb" --anims-only
$GT resample "$TMP/ual1.glb" "$OUT/anims/ual1.glb"
$GT resample "$TMP/ual2.glb" "$OUT/anims/ual2.glb"

node scripts/anim-index.mjs

rm -rf "$TMP"
du -sh "$OUT"/* "$OUT"
