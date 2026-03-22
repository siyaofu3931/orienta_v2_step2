PEK indoor route video
======================

File: pek_videoroute_E.MP4  (fallback: pek_videoroute_E.mp4 on case-sensitive disks)

This file is tracked with Git LFS so it can live on GitHub (normal Git rejects files > 100 MB).

Clone / pull on a new machine
------------------------------
  git lfs install
  git clone <repo-url>
  # LFS files download automatically on checkout with recent Git; if missing:
  git lfs pull

GitHub LFS quota
----------------
Free GitHub accounts include 1 GiB of LFS storage and 1 GiB/month bandwidth.
This video is ~1.7 GiB — you may need a paid "Git LFS Data" pack for the push
to succeed, or use a GitHub Team/Enterprise plan with higher limits.

See: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage

Alternative without LFS billing
-------------------------------
Upload the .MP4 as a Release asset (up to 2 GB per file on many plans), then
download it into this folder for local dev / deploy.
