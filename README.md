# Skills Collection

Skills for Claude and other coding agents. Each skill lives in its own folder with a `SKILL.md`.

## Included

- **codedeck** - Visualize one codebase: a self-contained HTML dashboard that pairs CodeFlow's deterministic facts (health grade, blast radius, call edges, dead code) with an easy-to-read story (growth, how-it-works mechanisms, user journeys, per-file role badges).
- **codedeck-system** - Micro service analytics. Turns a folder of separate service repos into a `system-map.html`: per-service static health + a cross-service call scan, reconciled against a New Relic service map + vitals, edge-by-edge as confirmed / static-only / runtime-only. Depends on the sibling `codedeck` skill.
- **devlingo** - Rewrites technical or programming writing into plain, natural, native-sounding English that stays on the issue and never sounds like a teacher or a know-it-all. Use it on messages, PR comments, docs, replies, and explanations.

## Install

Copy a skill folder into your agent's skills directory. For Claude, put the folder where your skills plugin looks for them, then reference it when you want that voice.

For Claude Code / Codex / Cursor, copy the whole runnable skill folder (including its `scripts/`):

```bash
cp -r codedeck ~/.agents/skills/          # or your agent's skills dir
cp -r codedeck-system ~/.agents/skills/   # needs codedeck present too
```

`codedeck` and `codedeck-system` clone the CodeFlow analyzer once on first run (`~/.cache/codedeck/codeflow`).

## Add your own

Add a folder per skill with a `SKILL.md` at its root. Keep each skill small and single-purpose.
