# Third-party notices

Motion Doll Studio itself is MIT licensed (see LICENSE). It bundles or uses the following. Licenses were read from each package's `package.json` at the pinned versions.

## Assets and models

| Component | License | Notes |
| --- | --- | --- |
| Quaternius characters (Mannequin F/M, Superhero M/F, hairstyles) and the Universal Animation Library 1 and 2 clips | CC0 1.0 Universal | https://quaternius.com. Converted and resampled with glTF-Transform. Details in `public/assets/CREDITS.md`. |
| MediaPipe Pose Landmarker models (`pose_landmarker_full.task`, optionally heavy) | Apache-2.0 | Google. Downloaded by `npm run fetch-models` (not committed) or loaded from Google storage when missing. |
| Inter and JetBrains Mono fonts | SIL Open Font License 1.1 | Loaded from Google Fonts at runtime; not redistributed in this repository. |

## Runtime dependencies (web app)

| Package | Version | License |
| --- | --- | --- |
| @mediapipe/tasks-vision | 0.10.8 | Apache-2.0 |
| three | 0.169.0 | MIT |
| @react-three/fiber | 8.17.10 | MIT |
| @react-three/drei | 9.114.3 | MIT |
| @pixiv/three-vrm | 3.5.5 | MIT |
| react, react-dom | 18.3.1 | MIT |
| zustand | 4.5.5 | MIT |
| fflate | 0.8.2 | MIT |
| webm-muxer | 5.0.3 | MIT |
| mp4-muxer | 5.2.2 | MIT |

## MCP server (`motion-doll-mcp`)

| Package | Version | License |
| --- | --- | --- |
| @modelcontextprotocol/sdk | 1.17.5 | MIT |
| ws | 8.18.3 | MIT |
| zod | 3.23.8 | MIT |

## Development only

Vite, Vitest, TypeScript, @vitejs/plugin-react, sharp and glTF-Transform are used at build time and are not shipped in the production bundle. Their licenses are MIT, Apache-2.0 or similar permissive terms; see each package.

Transitive dependencies carry their own licenses; run `npx license-checker --production` for the full list.
