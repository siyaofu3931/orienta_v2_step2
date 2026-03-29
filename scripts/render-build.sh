#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PEK_OUT="vite/public/route_site/pek_videoroute_E.MP4"

if [[ -n "${PEK_VIDEO_URL:-}" ]]; then
  echo "Downloading pek_videoroute_E.MP4 from PEK_VIDEO_URL (avoids Git LFS)..."
  curl -fL --retry 3 --retry-delay 2 -o "$PEK_OUT" "$PEK_VIDEO_URL"
  sz=$(wc -c <"$PEK_OUT" | tr -d " ")
  if [[ "$sz" -lt 1048576 ]]; then
    echo "error: downloaded file is too small (${sz} bytes); check PEK_VIDEO_URL and release asset filename (.MP4 vs .mp4)."
    exit 1
  fi
  echo "OK: $(basename "$PEK_OUT") size ${sz} bytes"
elif [[ -f "$PEK_OUT" ]]; then
  echo "Using existing $PEK_OUT (no PEK_VIDEO_URL set)."
else
  echo "warning: PEK_VIDEO_URL unset and $PEK_OUT missing — PEK video will 404 after build (gitignored)."
fi

# On Render, never ship a build without the PEK asset (avoids silent 404 in production).
if [[ "${RENDER:-}" == "true" ]] || [[ -n "${RENDER_EXTERNAL_URL:-}" ]]; then
  if [[ ! -f "$PEK_OUT" ]]; then
    echo "error: on Render, $PEK_OUT is missing after build prep. Fix: Build Command must be 'bash scripts/render-build.sh', Root Directory = repo root, PEK_VIDEO_URL set."
    exit 1
  fi
  sz=$(wc -c <"$PEK_OUT" | tr -d " ")
  if [[ "$sz" -lt 1048576 ]]; then
    echo "error: on Render, $PEK_OUT is too small (${sz} bytes) — download failed or wrong URL."
    exit 1
  fi
fi

cd vite
npm ci
npm run build
