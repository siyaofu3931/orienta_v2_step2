#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -n "${PEK_VIDEO_URL:-}" ]]; then
  echo "Downloading pek_videoroute_E.MP4 from PEK_VIDEO_URL (avoids Git LFS)..."
  curl -fL --retry 3 --retry-delay 2 -o vite/public/route_site/pek_videoroute_E.MP4 "$PEK_VIDEO_URL"
fi

cd vite
npm ci
npm run build
