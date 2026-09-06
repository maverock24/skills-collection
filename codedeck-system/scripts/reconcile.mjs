#!/usr/bin/env node
// codedeck-system: reconcile - join the three fact sources into one system model.
//   static  : discover.json services + per-repo CodeFlow grade + edges.json (scan-edges)
//   runtime : runtime.json from New Relic (mock or live, same normalized shape)
// Identity: our repo-derived service name is mapped to a New Relic entity name
//   (manifest override > exact match > case/normalized-insensitive fallback).
// Output  : system-facts.json used by the generator.
//
// Usage: node reconcile.mjs \
//   --services <discover.json> --edges <edges.json> --runtime <runtime.json> \
//   [--manifest codedeck-system.json] [--analyses <dir-with-codedeck-analysis.json>] \
//   [--out system-facts.json]

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

function parseArgs(argv) {
  const a = { services: null, edges: null, runtime: null, manifest: null, analyses: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--services' && argv[i + 1]) a.services = argv[i + 1];
    if (argv[i] === '--edges' && argv[i + 1]) a.edges = argv[i + 1];
    if (argv[i] === '--runtime' && argv[i + 1]) a.runtime = argv[i + 1];
    if (argv[i] === '--manifest' && argv[i + 1]) a.manifest = argv[i + 1];
    if (argv[i] === '--analyses' && argv[i + 1]) a.analyses = argv[i + 1];
    if (argv[i] === '--out' && argv[i + 1]) a.out = argv[i + 1];
  }
  const missing = ['services', 'edges', 'runtime'].filter((k) => !a[k]);
  if (missing.length) throw new Error('missing --' + missing.join(', --'));
  return a;
}

const readJson = async (p) => JSON.parse(await readFile(resolve(p), 'utf8'));
const norm = (s) => String(s || '').toLowerCase().replace(/-?(api|service|svc|app)$/, '');

async function main() {
  const a = parseArgs(process.argv);
  const disc = await readJson(a.services);
  const edges = await readJson(a.edges);
  const runtime = await readJson(a.runtime);
  const manifest = a.manifest ? await readJson(a.manifest) : null;

  const ours = disc.services || [];
  const ownName = new Set(ours.map((s) => s.name));
  const runtimeByName = new Map((runtime.services || []).map((s) => [s.nrName, s]));

  // manifest aliases: { services:[{ name, nrName }] } plus nrAliases {name:nrName}
  const alias = {};
  if (manifest?.services) for (const s of manifest.services) if (s.name && s.nrName) alias[s.name] = s.nrName;
  if (manifest?.nrAliases) Object.assign(alias, manifest.nrAliases);

  // map each of our services to an NR name
  const nrByNorm = new Map();
  for (const s of runtime.services || []) nrByNorm.set(norm(s.nrName), s.nrName);

  function resolveNr(name) {
    if (alias[name] && runtimeByName.has(alias[name])) return alias[name];
    if (runtimeByName.has(name)) return name;
    return nrByNorm.get(norm(name)) || null;
  }

  // per-service static grade from CodeFlow analysis JSON if available
  async function staticHealth(s) {
    if (!a.analyses) return null;
    try {
      const p = join(resolve(a.analyses), s.name, 'codedeck-analysis.json');
      const r = await readJson(p);
      return { grade: r.snapshot?.grade ?? null, score: r.snapshot?.score ?? null,
               files: r.snapshot?.files ?? null };
    } catch { return null; }
  }

  const services = [];
  const runtimeOnly = [];
  const seen = new Set();
  for (const rt of runtime.services || []) {
    const matched = ours.find((s) => resolveNr(s.name) === rt.nrName);
    if (matched) {
      seen.add(matched.name);
      services.push({ name: matched.name, repo: matched.repo, nrName: rt.nrName,
        matched: true, vitals: rt.vitals ?? null, runtimeGuid: rt.guid ?? null,
        staticHealth: await staticHealth(matched) });
    } else {
      runtimeOnly.push({ nrName: rt.nrName, type: rt.type, vitals: rt.vitals ?? null });
    }
  }
  for (const s of ours) {
    if (seen.has(s.name)) continue; // already emitted
    const nrName = resolveNr(s.name);
    services.push({ name: s.name, repo: s.repo, nrName, matched: !!nrName,
      vitals: nrName ? runtimeByName.get(nrName).vitals : null,
      staticHealth: await staticHealth(s),
      runtimeOnlyInFleet: false });
  }

  // ---- edge reconciliation ----
  const staticPairs = new Map();
  for (const e of edges.edges || []) {
    const k = `${e.source}->${e.target}`;
    const rec = staticPairs.get(k) || { source: e.source, target: e.target, types: [], evidence: [] };
    if (!rec.types.includes(e.type)) rec.types.push(e.type);
    (e.evidence || []).forEach((f) => !rec.evidence.includes(f) && rec.evidence.push(f));
    staticPairs.set(k, rec);
  }
  const runtimePairs = new Map();
  for (const c of runtime.connections || []) {
    const sk = resolveNr(c.source); const tk = resolveNr(c.target);
    if (!sk || !tk) continue; // unresolved to an owned service
    const k = `${sk}->${tk}`;
    const rec = runtimePairs.get(k) || { source: sk, target: tk, samples: 0, types: [] };
    rec.samples += c.samples || 0;
    if (!rec.types.includes(c.type || 'http')) rec.types.push(c.type || 'http');
    runtimePairs.set(k, rec);
  }

  const pairs = new Map();
  for (const k of new Set([...staticPairs.keys(), ...runtimePairs.keys()])) {
    const sp = staticPairs.get(k), rp = runtimePairs.get(k);
    pairs.set(k, { source: sp?.source || rp.source, target: sp?.target || rp.target,
      static: sp ? { types: sp.types, evidence: sp.evidence } : null,
      runtime: rp ? { types: rp.types, samples: rp.samples } : null,
      classification: sp && rp ? 'confirmed' : sp ? 'static-only' : 'runtime-only' });
  }

  const classification = { confirmed: [], staticOnly: [], runtimeOnly: [] };
  const keyOf = { confirmed: 'confirmed', 'static-only': 'staticOnly', 'runtime-only': 'runtimeOnly' };
  for (const e of pairs.values()) {
    const arr = classification[keyOf[e.classification]];
    if (arr) arr.push(`${e.source}->${e.target}`);
    else console.error('reconcile: unexpected classification', JSON.stringify(e));
  }

  const result = {
    generated_at: new Date().toISOString(),
    runtime_source: runtime.source || null,
    windowMinutes: runtime.windowMinutes ?? null,
    services, runtimeOnly,
    edges: [...pairs.values()],
    classification,
    orphans: edges.orphans || [],
    external: edges.external || [],
    identity_note: 'manifest > exact match > normalized fallback; unmatched NR entities are listed under runtimeOnly'
  };

  const json = JSON.stringify(result, null, 2);
  if (a.out) { const { writeFile } = await import('node:fs/promises'); await writeFile(resolve(a.out), json); }
  process.stdout.write(json + '\n');
}

main().catch((e) => { console.error('reconcile error:', e.stack || e.message); process.exitCode = 1; });
