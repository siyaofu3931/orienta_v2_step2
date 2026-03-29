#!/usr/bin/env bash
# Render: fetch PEK video from URL (file is not in git — avoids Git LFS).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/vite"

if [ -n "${PEK_VIDEO_URL:-}" ]; then
  echo "Downloading PEK route video..."
  mkdir -p public/route_site
  curl -fsSL "$PEK_VIDEO_URL" -o public/route_site/pek_videoroute_E.MP4
elif [ ! -f public/route_site/pek_videoroute_E.MP4 ]; then
  echo "Warning: pek_videoroute_E.MP4 missing and PEK_VIDEO_URL unset — PEK video will not play until you set PEK_VIDEO_URL on Render."
fi

npm ci
npm run build
