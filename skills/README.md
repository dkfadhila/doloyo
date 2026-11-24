# Doloyo skills

Agent skills that teach an AI agent how to make good animation with Doloyo's MCP tools. Each folder has a `SKILL.md` (YAML front matter with `name` and a `description` that says when to use it) and optional `references/*.md` with tables, recipes and worked examples. Every tool call in them uses real tool and argument names; `scripts/agents-md.test.ts` checks the `json tool-call` blocks against the MCP server's schemas.

| Skill | Use it for |
| --- | --- |
| [doloyo-director](doloyo-director/SKILL.md) | The whole workflow for a short: beat sheet, blocking, camera pass, preview renders, a scored critique loop, final render. Worked 30 s 9:16 fight example. |
| [doloyo-fight-choreography](doloyo-fight-choreography/SKILL.md) | Fights and action: anticipation, strike, impact hold, reaction; combos, escalation, finisher in three acts; spacing; measured contact timings of the built-in clips; hand-keyed kicks. |
| [doloyo-camera](doloyo-camera/SKILL.md) | The animated render camera: shot sizes, oblique angles, push-in, pull-back, track, crane, whip pan, punch-in, shake, hard cuts with adjacent keys, variety rules, 9:16 portrait framing, camera math. |
| [doloyo-keyframe-motion](doloyo-keyframe-motion/SKILL.md) | Keyframe craft on the 17-joint doll: pose-to-pose, easing and bezier curves, spacing, holds, overshoot, arcs, weight, foot pins, blending library clips without pops. |

## Install

**Claude Code**: copy the skill folders into your personal skills folder or into a project:

```
cp -r skills/doloyo-* ~/.claude/skills/            # every project
mkdir -p .claude/skills && cp -r skills/doloyo-* .claude/skills/   # one project
```

(On Windows: `%USERPROFILE%\.claude\skills\`.) Claude Code picks a skill when the task matches its description, or you can ask for it by name.

**Agents connected over MCP** (any client): no install needed. `guide_read` ends with the list of skills; `guide_read { "skill": "doloyo-camera" }` returns a skill and `guide_read { "skill": "doloyo-camera", "file": "references/camera-math.md" }` one of its reference files. The `doloyo-mcp` package bundles a copy (`mcp/guide/skills`, refreshed by `npm run mcp:build`).

**Other agents**: read the Markdown files as documentation, or paste the relevant `SKILL.md` into the agent's context.

## Credits

The skills are original text written for Doloyo. They were inspired by, and distil ideas from:

- **Seedance combat prompt skill** by Arvin (MIT): the fight-pacing ideas (opening impact within 1.5 s, rhythm and breath frames, the finisher in three acts, reaction differentiation, camera specs with shot size, angle, move and follow target, oblique angles instead of flat side-on, the rotation ban, combo camera recipes, cut continuity).
- **motion-design skill** by LottieFiles (MIT): Disney's 12 principles, easing directions, timing and easing tables, choreography rules (lead with the hero, staggering, attention direction).

Both are MIT licensed; no text was copied. The clip timings in `doloyo-fight-choreography` were measured from the Quaternius Universal Animation Library clips (CC0) that ship with Doloyo.
