#!/usr/bin/env node
// codedeck-system: discover service repos under a target folder.
//
// A "service" = a directory containing its own .git. We do not descend into a
// found repo (so a nested monorepo under a fleet repo is treated as one unit).
// A decoy folder without .git is naturally skipped.
//
// Name inference (highest first):
//   1. explicit override in a codedeck-system.json manifest at the root
//   2. package.json "name" (web/ts services)
//   3. folder basename
//
// Usage: node discover.mjs <root> [--manifest <file>]
// Outputs JSON to stdout: { root, services:[{name, repo, hint}], notes:[...] }

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, basename, resolve, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'vendor',
  'coverage', '.svelte-kit', '.netlify', 'target', '__pycache__', '.venv', 'venv']);

function parseArgs(argv) {
  const a = { root: process.argv[2] || '.', manifest: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--manifest' && argv[i + 1]) a.manifest = argv[i + 1];
  }
  if (!a.root) throw new Error('usage: node discover.mjs <root> [--manifest <file>]');
  return a;
}

async function looksLikeRepoDir(dir) {
  try { const st = await stat(join(dir, '.git')); return st.isDirectory() || st.isFile(); }
  catch { return false; }
}

async function readJsonIfExists(p) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
}

async function walkForRepos(dir, found) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (await looksLikeRepoDir(full)) {
      found.push(full);          // stop descending into this repo
    } else {
      await walkForRepos(full, found);
    }
  }
}

async function inferName(repoDir) {
  for (const cfg of ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']) {
    const raw = await readJsonIfExists(join(repoDir, cfg)).catch(() => null);
    if (raw && raw.name) return { name: String(raw.name), hint: cfg };
  }
  const py = await readJsonIfExists(join(repoDir, 'pyproject.toml')).catch(() => null);
  if (py) {
    const proj = py.project || py.tool?.poetry;
    if (proj?.name) return { name: String(proj.name), hint: 'pyproject' };
  }
  const gomod = await readFile(join(repoDir, 'go.mod'), 'utf8').catch(() => '');
  const m = gomod.match(/^module\s+([^\s]+)/m);
  if (m) return { name: m[1].split('/').pop(), hint: 'go.mod' };
  return { name: basename(repoDir), hint: 'folder' };
}

async function main() {
  const args = parseArgs(process.argv);
  const root = resolve(args.root);
  const repos = [];
  await walkForRepos(root, repos);
  repos.sort();

  // manifest overrides: { services: [{ name, repo }] } matched on resolved repo path
  let overrides = {};
  if (args.manifest) {
    const man = await readJsonIfExists(resolve(args.manifest));
    if (man?.services) {
      for (const s of man.services) {
        if (s.repo && s.name) overrides[resolve(root, s.repo)] = s.name;
      }
    }
  }

  const services = [];
  for (const repo of repos) {
    const inf = await inferName(repo);
    const name = overrides[repo] || inf.name;
    services.push({ name, repo, hint: inf.hint, override: !!overrides[repo] });
  }

  process.stdout.write(JSON.stringify({ root, services, notes: [] }, null, 2) + '\n');
}

main().catch((e) => { console.error('discover error:', e.message); process.exitCode = 1; });
