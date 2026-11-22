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
UBC="$SRC/quaternius-ubc/Universal Base Characters[Standard]/Base Characters/Godot - UE"
HAIR="$SRC/quaternius-ubc/Universal Base Characters[Standard]/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)"
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

# Superheroes: pack .gltf + .bin + png into one GLB, textures -> 1024px webp.
# The source gltf references two texture names that do not exist on disk (T_Eye_Normal_png.png, T_Hair_1_Normal_png.png): stage copies.
STAGE="$TMP/ubc"; mkdir -p "$STAGE"
cp "$UBC"/*.gltf "$UBC"/*.bin "$UBC"/*.png "$STAGE"/
cp "$STAGE/T_Eye_Normal.png" "$STAGE/T_Eye_Normal_png.png"
cp "$STAGE/T_Hair_1_Normal.png" "$STAGE/T_Hair_1_Normal_png.png"
# One hairstyle each (CC0, rigged to the head bone): merged into the body file and bound to the body skeleton by bone name.
for g in Male Female; do
  lc=$(echo "$g" | cut -c1 | tr "A-Z" "a-z")
  hair=Hair_SimpleParted; [ "$lc" = f ] && hair=Hair_Buns
  $GT copy "$STAGE/Superhero_${g}_FullBody.gltf" "$TMP/sh_$lc.glb"
  node scripts/merge-hair.mjs "$TMP/sh_$lc.glb" "$HAIR/$hair.gltf" "$TMP/sh_${lc}_h.glb"
  $GT resize "$TMP/sh_${lc}_h.glb" "$TMP/sh_${lc}_r.glb" --width 1024 --height 1024
  $GT webp "$TMP/sh_${lc}_r.glb" "$TMP/sh_${lc}_w.glb" --quality 85
  $GT dedup "$TMP/sh_${lc}_w.glb" "$TMP/sh_${lc}_d.glb"
  $GT prune "$TMP/sh_${lc}_d.glb" "$OUT/characters/superhero_$lc.glb"
done
rm -rf "$TMP"
du -sh "$OUT"/* "$OUT"
