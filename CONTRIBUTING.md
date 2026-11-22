# Contributing

Issues and pull requests are welcome.

## Setup

```
npm run setup        # install, build the MCP server, fetch the pose model
npm start            # dev server on http://localhost:5173
```

Node 18 or newer. Use npm (a lockfile is committed for the app and for `mcp/`).

## Before you open a pull request

```
npm test                       # vitest: core, retargeting, export, examples, tour
npm run build                  # tsc --noEmit + vite build
npm run smoke --prefix mcp     # MCP bridge smoke test
```

CI runs the same three.

## Conventions

- All project changes go through `dispatch(cmd)` in `src/store.ts` as JSON commands with an inverse (undo). New commands: add them to `src/core/commands.ts`, document them in `docs/AGENT.md` and `COMMAND_HELP`, add an MCP tool in `mcp/src/tools.ts`, and cover them in `src/core/*.test.ts` and `mcp/scripts/smoke.mjs`.
- `src/core` stays pure TypeScript (no React, no DOM, no three.js scene).
- UI: dark tokens from `src/styles.css`, Inter and JetBrains Mono, compact controls, no gradients, glow or emoji. It must work at 620 px wide.
- Everything stays local: no analytics, no uploads.
- Example projects are generated, not hand-edited: change `scripts/make-examples.ts` and run `npm run examples`.
- Bundled assets are CC0 or compatible; add new third-party material to `THIRD_PARTY_NOTICES.md` and `public/assets/CREDITS.md`.

Windows Git Bash rewrites `VITE_BASE=/name/`; prefix the command with `MSYS_NO_PATHCONV=1`.
