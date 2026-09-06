#!/usr/bin/env bash
# Make the CodeFlow headless analyzer available and run it over a project.
# Writes a deterministic facts JSON that the CodeDeck dashboard is built from.
#
# Usage: codeflow-analyze.sh <project-dir> [output.json]
#
# Why this exists: `npx codeflow` only serves a browser UI. The real Node
# analyzer ships inside the codeflow repo as card/analyze.js, so we keep a
# local clone and call it directly. Nothing here talks to a network at runtime
# once the clone exists.
set -euo pipefail

PROJECT="${1:-.}"
OUT="${2:-}"
CODEFLOW_HOME="${CODEFLOW_HOME:-$HOME/.cache/codedeck/codeflow}"
REPO_URL="https://github.com/braedonsaunders/codeflow.git"

PROJECT="$(cd "$PROJECT" && pwd)"
if [[ -z "$OUT" ]]; then OUT="$PROJECT/codedeck-analysis.json"; fi

if ! command -v node >/dev/null 2>&1; then
  echo "[codedeck] ERROR: node is required but not on PATH" >&2
  exit 1
fi

if [[ ! -f "$CODEFLOW_HOME/card/analyze.js" ]]; then
  echo "[codedeck] cloning CodeFlow analyzer into $CODEFLOW_HOME" >&2
  mkdir -p "$(dirname "$CODEFLOW_HOME")"
  git clone --depth 1 "$REPO_URL" "$CODEFLOW_HOME" >&2
fi

# Default excludes: CodeFlow ignores node_modules/.git but NOT SvelteKit/Netlify
# build output or lockfiles, which would swamp a dashboard with generated code.
# Override with CODEFLOW_EXCLUDES="a b c".
DEFAULT_EXCLUDES='.svelte-kit .netlify dist-mobile .vercel/output .output build dist .gradle **/assets/public *.lock pnpm-lock.yaml package-lock.json yarn.lock *.map';
EXCLUDES="${CODEFLOW_EXCLUDES:-$DEFAULT_EXCLUDES}"

args=(--path "$PROJECT")
for pat in $EXCLUDES; do
  args+=(--exclude "$pat")
done

echo "[codedeck] analyzing $PROJECT" >&2
echo "[codedeck] excludes: $EXCLUDES" >&2
node "$CODEFLOW_HOME/card/analyze.js" "${args[@]}" > "$OUT"
echo "[codedeck] wrote $OUT" >&2
