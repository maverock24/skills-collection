#!/usr/bin/env node
// codedeck-system: run.mjs - one-command orchestrator.
//   Point it at a folder of service repos; it produces a system-map.html.
//
// Usage: node scripts/run.mjs <target-fleet-dir>
//   --manifest <file>      optional codedeck-system.json (names/nrName aliases)
//   --mock <runtime.json>  optional: use a New Relic runtime file (tests)
//   --live  [--accountId N] optional: query New Relic on this machine
//   --label <name>         heading shown on the dashboard
//   --out <dir>            where artifacts land (default <target>/.codedeck-system)
//
// Runtime source order: --mock > --live > none (static-only dashboard).
// Reconcile + New Relic docs: see references/newrelic.md.

import { execFile } from 'node:child_process';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));        // .../scripts
const SKILL = resolve(HERE, '..');
const CODECLOW_HELPER = join(SKILL, '..', 'codedeck', 'scripts', 'codeflow-analyze.sh');

function parseArgs(argv) {
  const a = { target: null, manifest: null, mock: null, live: false, accountId: null, label: null, out: null };
  const pos = [];
  for (let i = 2; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--manifest') a.manifest = argv[++i];
    else if (v === '--mock') a.mock = argv[++i];
    else if (v === '--live') a.live = true;
    else if (v === '--accountId') a.accountId = argv[++i];
    else if (v === '--label') a.label = argv[++i];
    else if (v === '--out') a.out = argv[++i];
    else pos.push(v);
  }
  a.target = resolve(pos[0] || '.');
  return a;
}

async function node(script, args) {
  const { stdout } = await exec(process.execPath, [join(HERE, script), ...args], { cwd: SKILL });
  return stdout;
}
const sh = (p) => (p || '').replace(/-/g, '_').toLowerCase();

async function main() {
  const a = parseArgs(process.argv);
  const work = resolve(a.out || join(a.target, '.codedeck-system'));
  await mkdir(join(work, 'analyses'), { recursive: true });
  const step = (s) => console.log('\n[codedeck-system] ' + s);

  step('1/6 discover services under ' + a.target);
  const discArgs = [a.target]; if (a.manifest) discArgs.push('--manifest', a.manifest);
  const servicesJson = await node('discover.mjs', discArgs);
  await writeFile(join(work, 'services.json'), servicesJson);
  const services = JSON.parse(servicesJson).services || [];
  if (!services.length) { console.error('[codedeck-system] no service repos found under ' + a.target); process.exit(1); }
  console.log('   found: ' + services.map((s) => s.name).join(', '));

  step('2/6 per-service CodeFlow analysis');
  for (const s of services) {
    const outFile = join(work, 'analyses', s.name, 'codedeck-analysis.json');
    await mkdir(dirname(outFile), { recursive: true });
    console.log('   analyzing ' + s.name);
    await exec('bash', [CODECLOW_HELPER, s.repo, outFile], { cwd: SKILL });
  }

  step('3/6 static cross-service edge scan');
  const edgesJson = await node('scan-edges.mjs', ['--services', join(work, 'services.json')]);
  await writeFile(join(work, 'edges.json'), edgesJson);

  step('4/6 New Relic runtime source');
  let runtimeJson;
  if (a.mock) {
    await copyFile(resolve(a.mock), join(work, 'runtime.json'));
    runtimeJson = await node('newrelic.mjs', ['--mock', a.mock]);
    console.log('   using mock runtime: ' + a.mock);
  } else if (a.live) {
    const nrArgs = ['--live', '--out', join(work, 'runtime.json')];
    if (a.accountId) nrArgs.push('--accountId', a.accountId);
    runtimeJson = await node('newrelic.mjs', nrArgs);
    console.log('   queried New Relic (live)');
  } else {
    runtimeJson = JSON.stringify({ generated_at: new Date().toISOString(), source: 'none',
      windowMinutes: null, services: [], connections: [] }, null, 2);
    await writeFile(join(work, 'runtime.json'), runtimeJson);
    console.log('   no runtime source - building STATIC-ONLY dashboard (add --mock or --live)');
  }

  step('5/6 reconcile static + runtime');
  const recArgs = ['--services', join(work, 'services.json'), '--edges', join(work, 'edges.json'),
    '--runtime', join(work, 'runtime.json'), '--analyses', join(work, 'analyses'), '--out', join(work, 'facts.json')];
  if (a.manifest) recArgs.push('--manifest', a.manifest);
  await node('reconcile.mjs', recArgs);

  step('6/6 generate dashboard');
  const outHtml = join(work, 'system-map.html');
  const genArgs = ['--facts', join(work, 'facts.json'), '--analyses', join(work, 'analyses'),
    '--out', outHtml];
  if (a.label) genArgs.push('--fleet-label', a.label);
  await node('generate.mjs', genArgs);

  console.log('\n[codedeck-system] DONE');
  console.log('   dashboard: ' + outHtml);
  console.log('   facts:     ' + join(work, 'facts.json'));
  console.log('   runtime:   ' + JSON.parse(runtimeJson).source || 'none');
}

main().catch((e) => { console.error('[codedeck-system] error:', e.message); process.exitCode = 1; });
