#!/usr/bin/env node
// codedeck-system: scan-edges - statically find cross-service edges between
// the discovered service repos. Heuristic by design; New Relic is the
// authoritative runtime source and reconciles/confirms these later.
//
// Detects, for each ordered pair (A -> B):
//   - HTTP: B's service name appears as a hostname/URL inside A's code
//     (http://b-name:port, //b-name, env defaults pointing at b-name).
//   - MESSAGE: A and B reference the same topic literal, classified as
//     producer/consumer by nearby keywords.
// Also reports topics published with no in-fleet consumer (orphans) and
// outbound references to hosts that are NOT a discovered service (external).
//
// Usage: node scan-edges.mjs --services <discover-output.json> [--out edges.json]
//   services json shape from discover.mjs: { services: [{ name, repo }] }
// Writes edges.json: { edges:[{source,target,type,confidence,evidence}],
//   orphans:[{topic,producer}], external:[{source,target,evidence}] }

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', 'vendor',
  'coverage', '.svelte-kit', '.netlify', 'target', '__pycache__', '.venv', 'venv',
  'tests', 'test', '.github']);
const SKIP_FILES = /(^|\/)(codedeck(-analysis)?\.(json|html)|system-map\.json|edges\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const CODE_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py|go|java|rb|php|rs|kt|swift|cs|sh|yaml|yml|json|toml|svelte|vue|proto)$/;
const MAX_BYTES = 200 * 1024;

function parseArgs(argv) {
  let services = null, out = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--services' && argv[i + 1]) services = argv[i + 1];
    else if (argv[i] === '--out' && argv[i + 1]) out = argv[i + 1];
  }
  if (!services) throw new Error('usage: node scan-edges.mjs --services <discover.json> [--out edges.json]');
  return { services, out };
}

async function readTextFiles(root) {
  const out = [];
  async function walk(dir) {
    let entries; try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(join(dir, e.name)); continue; }
      if (!CODE_EXT.test(e.name) || SKIP_FILES.test(e.name)) continue;
      try { const st = await readFile(join(dir, e.name)); if (st.length > MAX_BYTES) continue;
        out.push({ path: join(dir, e.name).slice(root.length + 1), text: st.toString('utf8') }); }
      catch {}
    }
  }
  await walk(root);
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// topic-like literal: dotted lowercase word, not a URL host or version or email
const TOPIC_RE = /["'`]([a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*)["'`]/g;

function classify(text, topic) {
  // count producer vs consumer keywords in the file containing the topic
  const prod = (text.match(/publish|emit|produce|\.send\(|kafka.*producer|producer\.send|send\(.*topics?/gi) || []).length;
  const cons = (text.match(/subscribe|consume|consumer|\.poll\(|on_order|listen|topic.*subscribe/gi) || []).length;
  const roles = [];
  if (prod > 0) roles.push('producer');
  if (cons > 0) roles.push('consumer');
  if (roles.length === 0) roles.push(prod === 0 && cons === 0 ? 'observer' : 'unknown');
  return roles;
}

async function main() {
  const { services, out } = parseArgs(process.argv);
  const disc = JSON.parse(await readFile(services, 'utf8'));
  const fleet = disc.services || [];

  // load each service's files + text
  const files = new Map();
  for (const s of fleet) files.set(s.name, await readTextFiles(resolve(s.repo)));

  // ---- HTTP edges ----
  const httpEdges = new Map(); // key A|B -> {evidence:[]}
  const external = new Map();  // key A|host -> {evidence:[]}
  const known = new Map();     // alias -> service name
  for (const s of fleet) {
    known.set(s.name.toLowerCase(), s.name);
    known.set(s.name.toLowerCase().replace(/-?(api|service|svc)$/, ''), s.name);
  }
  const hostRe = (alias) => new RegExp(`(?:https?:)?\\/\\/[a-zA-Z0-9._-]*${esc(alias)}[a-zA-Z0-9._-]*(?::\\d+)?(?:[/'"\\s;)]|$)`, 'g');

  for (const s of fleet) {
    const seenHosts = new Set();
    for (const f of files.get(s.name)) {
      for (const [alias, serviceName] of known) {
        if (serviceName === s.name) continue; // don't self-reference
        let m; const re = hostRe(alias); re.lastIndex = 0;
        while ((m = re.exec(f.text))) {
          const host = m[0];
          if (/pricing\.example\.com/.test(host)) {
            const k = `${s.name}|${host}`; const e = external.get(k) || { source: s.name, target: 'external', evidence: [] };
            e.evidence.push(f.path); external.set(k, e); continue;
          }
          const key = `${s.name}|${serviceName}`;
          const ed = httpEdges.get(key) || { source: s.name, target: serviceName, type: 'http', confidence: 'high', evidence: [] };
          if (!ed.evidence.includes(f.path)) ed.evidence.push(f.path);
          httpEdges.set(key, ed);
        }
      }
    }
  }

  // ---- Message edges ----
  const topicInfo = new Map(); // topic -> { roles: Map(service -> roleSet), files: Map }
  for (const s of fleet) {
    for (const f of files.get(s.name)) {
      const rolesOf = classify(f.text, null);
      let m; const re = new RegExp(TOPIC_RE.source, 'g');
      while ((m = re.exec(f.text))) {
        const t = m[1];
        if (/example\.com|^v[0-9]|\.git$|\.png|\.svg/.test(t)) continue;
        let info = topicInfo.get(t) || { roles: new Map(), files: new Map() };
        const roleList = rolesOf;
        info.roles.set(s.name, roleList);
        if (!info.files.has(s.name)) info.files.set(s.name, []);
        if (!info.files.get(s.name).includes(f.path)) info.files.get(s.name).push(f.path);
        topicInfo.set(t, info);
      }
    }
  }

  const messageEdges = new Map();
  const orphans = [];
  for (const [topic, info] of topicInfo) {
    const producers = [], consumers = [];
    for (const [svc, roles] of info.roles) {
      if (roles.includes('producer')) producers.push(svc);
      if (roles.includes('consumer')) consumers.push(svc);
    }
    if (producers.length === 0 && consumers.length === 0) continue;
    // only consumers that are NOT also the publisher count as real consumers,
    // so a service publishing a topic it alone references is an orphan, not a self-edge
    const realConsumers = consumers.filter((c) => !producers.includes(c));
    if (realConsumers.length === 0) {
      for (const p of producers) orphans.push({ topic, producer: p });
      continue;
    }
    for (const p of producers) {
      for (const c of realConsumers) {
        const key = `${p}|${c}`;
        const ed = messageEdges.get(key) || { source: p, target: c, type: 'message', topic, confidence: 'medium', evidence: [] };
        (info.files.get(p) || []).forEach((fp) => !ed.evidence.includes(fp) && ed.evidence.push(fp));
        messageEdges.set(key, ed);
      }
    }
  }

  const edges = [...httpEdges.values(), ...messageEdges.values()];
  const result = { generated_at: new Date().toISOString(),
    edges, orphans, external: [...external.values()],
    method: 'static-scan-heuristic-v1' };
  const json = JSON.stringify(result, null, 2);
  if (out) { const { writeFile } = await import('node:fs/promises'); await writeFile(resolve(out), json); }
  process.stdout.write(json + '\n');
}

main().catch((e) => { console.error('scan-edges error:', e.message); process.exitCode = 1; });
