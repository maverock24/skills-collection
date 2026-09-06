---
name: codedeck-system
description: Micro service analytics. Turn a FOLDER OF SEPARATE SERVICE REPOS into one self-contained system-map.html that pairs static facts (per-service CodeFlow health + a cross-service call scan) with live runtime facts (New Relic service map + vitals), reconciled edge-by-edge as confirmed / static-only / runtime-only. Use when asked to "analyze my microservices", "map the services", "system overview / fleet dashboard", "which service calls which", "what's degrading in production", or when onboarding onto a multi-service codebase. A sibling to the single-repo codedeck skill.
---

# codedeck-system

The single-repo `codedeck` skill answers "what does this one codebase do". This
skill answers "what do these many services do, how do they call each other, and
does production agree with the code?" It is built for a folder holding several
independent git repos treated as one system.

## Two fact sources, reconciled honestly

- **Static** - what the code says. Per-service health from the CodeFlow analyzer
  (reused from the sibling `codedeck` skill), plus a cross-service call scan
  (HTTP base URLs / hosts, inline calls, message topics). Heuristic, best-effort.
- **Runtime** - what production does. New Relic service map + vitals. Optional;
  if unavailable the dashboard degrades to static-only with a clear notice.

Every edge is then classified by which sources saw it:

- **confirmed** - your code AND New Relic agree.
- **static-only** - coded but not observed in production (dead path? not deployed?).
- **runtime-only** - production makes this call but no repo in your folder explains
  it (missing repo or an external dependency). New Relic catches what static can't.

## How to run

One command does the whole pipeline:

```bash
bash <skill_dir>/scripts/run.mjs <fleet-dir> [--out <dir>]
```

Flags:
- `--mock <runtime.json>` - use a saved New Relic runtime file (tests / offline).
- `--live [--accountId N]` - query New Relic on this machine (needs CLI + API key).
- `--manifest <codedeck-system.json>` - fix service names and map each repo to its
  New Relic entity name: `{ "services": [{ "name", "repo", "nrName" }] }`.
- `--label "Name"` - heading on the dashboard.
- Default output dir: `<fleet>/.codedeck-system/`, containing `system-map.html`
  plus the intermediate `services.json / edges.json / runtime.json / facts.json`.

Artifacts land in the output dir, so nothing is written into your service repos.

## Pipeline (what run.mjs does)

1. **Discover** - find the git repos under the folder; infer names.
   `scripts/discover.mjs`
2. **Per-service analysis** - CodeFlow health per repo (grade, blast, dead code).
   Reuses `codedeck/scripts/codeflow-analyze.sh`.
3. **Edge scan** - statically find cross-service calls.
   `scripts/scan-edges.mjs` (heuristics: hosts/base URLs, message topics).
4. **Runtime** - New Relic map + vitals. `scripts/newrelic.mjs`
   (`--mock` or `--live`). None provided => static-only.
5. **Reconcile** - join static + runtime, resolve repo<->NR identity, classify
   edges. `scripts/reconcile.mjs` -> `facts.json`.
6. **Generate** - render `system-map.html`. `scripts/generate.mjs`.

Each step can also be run on its own; see `references/newrelic.md` and the
individual script usage strings.

## Reading the dashboard

Tabs: **Overview** (fleet stats + health mix + degrading services), **Topology**
(live/confirmed edge ring, color = health), **Services** (repo + static grade +
live vitals side by side), **Cross-service risk** (edge classification, orphan
topics, fan-in/out), **Growth** (per-repo git), **Drill-down** (per-service
analyzer detail). For a full single-repo deep dashboard of one service, run the
`sibling codedeck` skill on that repo.

## Rules

- Never invent a runtime number: vitals come only from New Relic data. If NR is
  off, show "runtime unavailable", not guesses.
- Static edges are labeled as heuristic; New Relic is authoritative for what
  actually runs.
- A repo-derived name that maps to no NR entity is shown as "no NR entity",
  never silently dropped.
- If a service has no repo but appears in the map, call it runtime-only and say
  so - it may be a dependency you forgot to include or an external service.

## Triggers

"analyze my microservices", "system/fleet dashboard", "map which service calls
which", "generate system deck", "update system deck", "what is degrading in
production", "onboard me to these services".
