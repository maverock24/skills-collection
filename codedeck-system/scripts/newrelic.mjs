#!/usr/bin/env node
// codedeck-system: newrelic - produce the runtime.json fact source on the
// target machine (where the New Relic CLI + credentials live).
//
// Two modes:
//   --mock <file>   load a normalized runtime.json from disk (tests / dry runs)
//   --live          query New Relic via the CLI and write runtime.json
//
// The normalized shape (see references/newrelic.md for how it is produced):
//   { services:[{nrName,guid,type,language,vitals}], connections:[{source,target,type,samples}] }
//
// --live is NOT exercised in this dev environment (no New Relic here). It
// shells out to the `newrelic` CLI; if that is missing it exits with guidance.
// Production log/query access is assumed available on the target machine.

import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const exec = promisify(execFile);

function parseArgs(argv) {
  const a = { mock: null, live: false, out: null, accountId: null, windowMinutes: 60 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--mock' && argv[i + 1]) a.mock = argv[i + 1];
    if (argv[i] === '--out' && argv[i + 1]) a.out = argv[i + 1];
    if (argv[i] === '--accountId' && argv[i + 1]) a.accountId = argv[i + 1];
    if (argv[i] === '--live') a.live = true;
    if (argv[i] === '--window' && argv[i + 1]) a.windowMinutes = Number(argv[i + 1]);
  }
  return a;
}

// Run a NerdGraph query through the newrelic CLI (target machine only).
async function nerdGraph(query) {
  const { stdout } = await exec('newrelic', ['nerdgraph', 'query', query]);
  return JSON.parse(stdout);
}

async function liveFetch(a) {
  const apiKey = process.env.NEW_RELIC_API_KEY;
  if (!apiKey && !process.env.NEW_RELIC_USER_API_KEY) {
    throw new Error('--live needs a New Relic API key (NEW_RELIC_API_KEY / NEW_RELIC_USER_API_KEY)');
  }
  // Entity search: all APM applications in the account.
  const search = await nerdGraph(`{ actor { account(id: ${a.accountId}) {
    nrql(query: "SELECT rate(count(*),1) AS 'throughput' FROM Transaction FACET appName") { results } } } }`);
  // NOTE: real implementation should drive vitals from NRQL over Transaction /
  // TransactionError (apdex, error%, p95 latency) and the service map from
  // entity relatedEntities. See references/newrelic.md.
  // This function intentionally returns a stub shape so the rest of the
  // pipeline (reconcile) is exercised; fill the queries when wiring on target.
  return {
    generated_at: new Date().toISOString(),
    accountId: a.accountId,
    source: 'newrelic-live',
    windowMinutes: a.windowMinutes,
    services: [], connections: [],
    _rawSearchCount: search?.data?.actor?.account?.nrql?.results?.length ?? null
  };
}

async function main() {
  const a = parseArgs(process.argv);
  let runtime;
  if (a.mock) {
    runtime = JSON.parse(await readFile(resolve(a.mock), 'utf8'));
  } else if (a.live) {
    runtime = await liveFetch(a);
  } else {
    throw new Error('usage: node newrelic.mjs --mock <runtime.json> | --live [--accountId N] [--out runtime.json]');
  }
  const json = JSON.stringify(runtime, null, 2);
  if (a.out) { const { writeFile } = await import('node:fs/promises'); await writeFile(resolve(a.out), json); }
  process.stdout.write(json + '\n');
}

main().catch((e) => { console.error('newrelic error:', e.stack || e.message); process.exitCode = 1; });
