PEK indoor route video
======================

File: pek_videoroute_E.MP4  (fallback: pek_videoroute_E.mp4 on case-sensitive disks)

This file is not stored in Git (avoids GitHub’s 100 MB blob limit and Git LFS quota on
hosts like Render that meter LFS).

Hosting via GitHub Releases (current)
---------------------------------------
Use a public repo so the asset URL works without a token (Render’s build only runs curl).

1. On GitHub: open your repo → Releases → “Draft a new release”.
2. Choose a tag (e.g. `pek-video-1` or `v0.1.0-pek`). Create the tag if it does not exist.
3. Title/description optional. Attach **pek_videoroute_E.MP4** under “Attach binaries”.
4. Publish the release.

Direct download URL format (copy from the release asset link, or build it yourself):

  https://github.com/OWNER/REPO/releases/download/TAG/pek_videoroute_E.MP4

Example:

  https://github.com/myorg/orienta/releases/download/pek-video-1/pek_videoroute_E.MP4

Render: set environment variable **PEK_VIDEO_URL** to that exact URL (Dashboard → your
web service → Environment). The build runs **scripts/render-build.sh**, which downloads
the file before `vite build`.

**Render “Root Directory”** must be the **repository root** (leave blank / `.`), not
`vite`. If Root Directory is `vite`, `bash scripts/render-build.sh` never runs from the
right place and the MP4 is never downloaded — you get a 404 for `/route_site/pek_videoroute_E.MP4`.

Note: on a **public** repo, anyone can download this asset. **Private** repos need an
authenticated URL/token for curl—prefer a public release for simplicity, or use R2/S3 later.

Local development
-----------------
Place your own copy of the MP4 in this folder, or download once:

  curl -fL -o pek_videoroute_E.MP4 "https://github.com/OWNER/REPO/releases/download/TAG/pek_videoroute_E.MP4"

Other hosts (optional)
----------------------
Cloudflare R2, S3, etc. still work with PEK_VIDEO_URL if you switch later.
