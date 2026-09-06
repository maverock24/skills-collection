# codedeck-system — plan (agreed)

Improve the codedeck skill toward micro service analytics by adding a **sibling**
skill, `codedeck-system`, that turns a **folder of separate service repos** into
one self-contained system dashboard. The existing single-repo `codedeck` stays as
the click-through drill-down for each service.

## Decisions (locked with the user)

- Target: a **folder of separate git repos** treated as one system.
- Audience: **mixed** - readable overview + technical depth for engineers.
- Depth: **full** - system map, per-service health, click into each service's
  full function/call-graph dashboard.
- Cross-service edges: **static scan of service code** + **New Relic CLI** (live
  prod service map + per-service vitals: apdex, error rate, throughput, latency).
- New Relic runs on the **target machine** (not present in this dev environment),
  so it is an optional, credential-guarded layer that degrades to static-only.
- System view sections: **overview, live topology, service inventory,
  cross-service risk, growth, drill-down**.
- Identity mapping: **heuristic first** (folder / package.json / compose name),
  optional hand-written manifest to fix aliases. NR names authoritative at runtime.
- Skill name: `codedeck-system`. Output filename default: `system-map.html`.
- Validation here: a **synthetic mini-fleet** (no New Relic) + a **mock NR
  response** to test edge detection and rendering.

## Pipeline

1. **Discover** - find git repos under the target folder; infer a service name.
2. **Per-service static** - run CodeFlow analyzer per repo (reuse
   `codedeck/scripts/codeflow-analyze.sh`): grade, internal blast radius, dead
   code, largest files, call edges.
3. **Cross-service edge scan** - across all repos, find outbound calls resolving
   to another discovered service (HTTP clients, base URLs/aliases, gRPC,
   message-bus topics, env-config service URLs). Tag edges with confidence.
4. **New Relic (target machine)** - real service map + per-service vitals. Soft
   fail when no CLI/key.
5. **Reconcile** - static edges vs NR edges: confirmed / static-only / NR-only.
   Surface orphan services and heavy fan-in/out.
6. **Generate** `system-map.html` (self-contained) with the six sections.
7. **Snapshot** `system-map.json` for `update system deck` diffs.

## New Relic handling

- Install + configure once on the target machine (CLI, API key, account).
- Guard: if `newrelic` CLI or credentials are missing, emit static-only view with
  a clear notice; never crash.
- Code the NR layer against New Relic's schema; test parsing with a mock JSON
  response so it is testable here without NR.

## Skill layout

```
~/.agents/skills/codedeck-system/
  SKILL.md
  scripts/
    discover.sh          # enumerate service repos + infer names
    analyze-all.sh       # per-service CodeFlow via codedeck helper
    scan-edges.<sh/py>   # static cross-service call detection
    newrelic.<sh/py>     # NR service map + vitals (guarded)
    generate.<sh/py>     # build system-map.html + system-map.json
  references/
    edge-scanning.md     # heuristics, confidence levels
    newrelic.md          # install, schema, mock
  tests/
    fixtures/mini-fleet/ # synthetic service repos + mock NR response
```

## Build order (verify incrementally)

1. `discover` + synthetic mini-fleet + per-service analysis  ✅
2. `scan-edges` - detect cross-service calls in the mini-fleet  ✅
3. NR layer against a mock NR response (parse + vitals reconciliation)  ✅
4. `generate` - system dashboard rendering  ✅
5. Full end-to-end on the mini-fleet  ✅ (static-only and --mock both verified)

## Status (2026-09-06)

Pipeline complete and verified end to end on the mini-fleet. All scripts under
`scripts/`, docs under `references/`, fixtures under `tests/fixtures/`. The
orchestrator is `scripts/run.mjs`. The New Relic `--live` path is written but
NOT exercised here (no NR in this env); run it on the target machine with an
API key per `references/newrelic.md`.

Known gaps / future work:
- External (non-fleet) host detection in scan-edges is unwired (catalog calls
  `pricing.example.com` but it is not reported).
- Topology tab uses a ring layout; fine for small fleets, crowded for large ones.
- Per-service drill-down embeds analyzer summaries; full single-repo deep views
  come from the sibling `codedeck` skill (not auto-linked yet).
- No automated regression test yet (build one to lock the expected mini-fleet edges).
