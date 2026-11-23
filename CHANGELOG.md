# Changelog

## 0.5.0 (body sizes)

- Body sizes for mannequins: Bayi / Kecil (baby, about 12 months, 0.75 m), Anak (child, about 6-7 years, 1.20 m), Remaja (teenager, 1.62 m, F 1.58 m) and Dewasa (adult, the original look), for male and female, plus a +-10% height fine-tune per object.
- One proportion profile drives everything: FK, IK, foot pins, Copy Dance foot lock, onion ghosts, pick volumes, GLB and BVH export and the skinned mannequins (bone scales and offsets, relative head size, feet kept on the floor). Pose data stays rotations, so keys, baked clips and mocap work on any body; hips translation keys are stored in adult units and scaled by the body.
- Child presets are neutral art mannequins: Kecil and Anak (and Remaja) use the neutral Mannequin M mesh for both genders; gender only nudges the shoulder width. Only Dewasa F uses Mannequin F. Superheroes allow Remaja and Dewasa only.
- Command and MCP tool `object_set_body`; `object_add` and `scene_preset` accept `body`; `scene_get` lists each mannequin body and height.
- Three baby poses that solve the hips height from the body: `duduk` (sitting), `merangkak` (crawling), `berdiri_pegangan` (standing, holding on).
- Scene presets are mixed gender by default (alternating F and M) and there is a new `keluarga` preset (2 adults, 1 anak, 1 sitting bayi).
- Inspector Body section (segmented size, height slider in meters, M/F switch) and Outliner quick add for the 8 variants (Bayi, Anak, Remaja, Dewasa; cowok and cewek).

## 0.4.0 (release preparation)

- Static hosting: configurable base path (`VITE_BASE`), hashed bundles in `/bundle`, deploy configs for Vercel, Netlify and Cloudflare Pages (`vercel.json`, `netlify.toml`, `public/_headers`), GitHub Actions CI and a manual GitHub Pages workflow.
- Copy Dance falls back to the pinned MediaPipe WASM (jsDelivr) and model (Google storage) when `public/mediapipe` is missing; the dialog says when the CDN is used. `npm run build` fetches the local copy through a prebuild hook.
- `motion-doll-mcp` is npm-ready (not published): `--origin <url>` (repeatable), `--allow-hosted`, `--port`, `--help`, `--version`, `prepublishOnly`.
- Agent panel explains the Private Network Access prompt on https pages and the Safari limitation.
- First-run tour (5 steps, skippable, reopen from Help > Tour), Help menu with Guide, Tour, Examples, Keyboard shortcuts and About.
- Three example projects (Wave hello, Dance crew, Sword duel) generated from the command API (`npm run examples`).
- LICENSE (MIT), CONTRIBUTING, THIRD_PARTY_NOTICES, public README, favicon.

## 0.3.0 (Phase 3, Pro)

- Two-bone IK, foot pins and Bake pins; curve editor with bezier easing; key editing (zoom, marquee, multi-move, copy/paste).
- Animated render camera with look-through and safe frame; GLB and BVH export; scene presets (duo, trio, group of 5).

## 0.2.0 (Phases 2 and 2.5)

- MCP agent bridge (`mcp/`), pairing code, permission modes, WebM/MP4 (WebCodecs) and PNG sequence export, onion skin, pose library.
- Characters (Quaternius mannequins and superheroes, GLB and VRM import) with skeleton retargeting, 86-clip animation library, Copy Dance video mocap with MediaPipe.

## 0.1.0 (Phase 1, MVP)

- Procedural 17-joint mannequin and basic shapes, FK posing with gizmo, outliner and inspector, keyframe timeline with easing, undo/redo through inverse commands, snapshot PNG, IndexedDB autosave and `.mdoll.json` files, built-in guide.
