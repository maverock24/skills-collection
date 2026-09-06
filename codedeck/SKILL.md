---
name: codedeck
description: Generate an interactive, self-contained HTML map of a codebase that pairs hard deterministic facts (real function-level dependencies, blast radius, health grade, dead code, security findings, from the CodeFlow analyzer) with an easy-to-read story (growth, how-it-works mechanisms, user journeys, per-file role badges). Use when asked to "map the codebase", "visualize my project", "show what breaks if I change X", "generate a project overview or dashboard", "explain how this codebase works", or when onboarding onto an unfamiliar repo.
---

# CodeDeck

A project map with two sources, kept honest and separate:

- **Fact layer** - what the CodeFlow analyzer computes by parsing: health grade, real call edges, blast radius ("if I change this file, what breaks?"), dead functions, circular deps, god objects, layer violations, security findings. These numbers are exact. Quote them, never invent them.
- **Story layer** - what you infer by reading: file roles, mechanisms, user journeys, growth narrative. These are explanations. Label them as explanations. A judgement presented as a fact is the one unforgivable bug in this skill.

The point of splitting them: CoDeck alone guesses everything, so its dashboard can drift from the code. CodeFlow alone gives cold metrics with no story. CodeDeck gives both and tells you which is which.

## Output

One self-contained HTML file, default `codedeck.html` in the project root, plus a `codedeck.json` snapshot for later diffing. Inline CSS + JS, no build step, opens in any modern browser.

## Workflow

### Step 1 - Gather the facts (CodeFlow)

Run the helper against the project root:

```bash
bash <skill_dir>/scripts/codeflow-analyze.sh <project-dir>
```

It makes sure the analyzer exists (clones once into `~/.cache/codedeck/codeflow`), then writes `<project-dir>/codedeck-analysis.json`. On first run it needs network once; after that it works offline.

Read the JSON. Useful fields:

- `snapshot.grade`, `snapshot.score` - health letter and number.
- `snapshot.topBlast` - the file whose change hits the most other files.
- `files[].dependents` - per-file blast radius, `files[].functions`, `files[].folder`.
- `connections[]` - real call edges with source, target, function name, count.
- `deadFunctions[]`, `securityIssues[]`, `duplicates[]`, `layerViolations[]`, `patterns[]`, `issues[]`.

**If the analyzer finds no real code** (doc/skill repo, or it failed): say so plainly on the Health tab - "no deterministic layer here" - and keep going with the story layer only. Do not fake a grade or fabricate a blast radius.

### Step 2 - Read the code (story)

Scan like a careful human: package/config files for stack, entry points, routes/APIs, data models, README, and git history (commit cadence, first commit, milestones, churn hotspots). Read core files for real, do not guess from filenames.

### Step 3 - Build the models

- Health and blast - lift directly from the facts JSON.
- Growth - git history told as a timeline (weekly commits, milestone keywords like "feat / add / launch / v1 / first").
- Mechanisms - the 3-5 core end-to-end flows ("when the user clicks X, then Y happens...").
- Journeys - entry point to exit, branches, happy path, error states.
- Architecture - layers (UI / Logic / Data). Every file becomes a node with its role text *and* its facts (dependents, blast, last modified).

### Step 4 - Detect dashboard language

English, Chinese, etc. Check README/docs, sample code comments, recent commit messages, package metadata. Two or more signals agree on one language, use it. Mixed or no signal: ask the user. Never silently default.

### Step 5 - Generate `codedeck.html`

Sections in order:

1. Header - project name, stack badges, generated time, one-line summary.
2. Health and blast - the deterministic section CoDeck alone cannot produce. Grade, score, dead code %, blast radius of the riskiest file, top dependents, security findings with file references, call-edge count. If the project is too small for a meaningful graph, say so.
3. Growth story.
4. How it works (mechanisms).
5. User journey.
6. Architecture with per-file drill-down - each file shows its plain-language role plus its measured dependents and blast. Mark facts vs inferred roles so a reader trusts the right ones.
7. Footer - generation time and the "update" trigger.

Design rules: one consistent palette and type scale, readable fonts, sensible spacing, no cargo-cult AI clutter, responsive layout, and it should still look fine printed. Every stat is clickable/drillable where useful but nothing is decorative-only.

### Step 6 - Write the snapshot

Write `codedeck.json` with `generated_at`, `project_name`, the key facts, and the per-file roles. Later an "update code deck" run reads it, diffs against a fresh analysis, and highlights what changed - that diff is often the most useful thing you can show someone who just had an agent rewrite half their code.

## Rules

- Facts come from the analyzer. If you are not copying them from `codedeck-analysis.json`, you are guessing and it must be labeled as such.
- File roles are plain-language readings. When a file's purpose is unclear, write "Role unclear from reading" - never improvise.
- Never invent a number, a dependency, or a security finding. No finding is better than a fake finding.
- Never silently pick the dashboard language. Ask.
- When in doubt about scale, lean simpler. A clean 3-tab map beats a bloated 7-tab one.

## Triggers

"map this project", "codebase dashboard", "visualize my repo", "generate code deck", "update code deck", "what breaks if I change <file>", "onboard me to this codebase", "show me what this project does".
