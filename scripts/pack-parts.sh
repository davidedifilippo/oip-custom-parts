#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OIP_WEB_DIR="${OIP_WEB_DIR:-/Users/ingdifilippo/Antigravity_projects_2026/Open_Industry_Project}"
DIST_DIR="$REPO_ROOT/dist"

mkdir -p "$DIST_DIR"

echo "=== OIP Custom Parts: Build, Validate & Package ==="

for part_dir in "$REPO_ROOT"/user.*; do
  [ -d "$part_dir" ] || continue
  part_id="$(basename "$part_dir")"
  echo ""
  echo "--> Processing $part_id ..."

  if [ -d "$OIP_WEB_DIR" ]; then
    if [ -f "$part_dir/part.js" ]; then
      (cd "$OIP_WEB_DIR" && npm run --silent build-parts -- "$part_dir")
    fi
    (cd "$OIP_WEB_DIR" && npm run --silent check-part -- "$part_dir")
  fi

  out_pkg="$DIST_DIR/${part_id}.oippart"
  rm -f "$out_pkg"
  (
    cd "$part_dir"
    if [ -d "assets" ]; then
      zip -q -r "$out_pkg" manifest.json behavior.js assets/
    else
      zip -q -r "$out_pkg" manifest.json behavior.js
    fi
  )
  echo "✓ Packaged: dist/${part_id}.oippart"
done

echo ""
echo "=== All parts validated and packaged in dist/ ==="
