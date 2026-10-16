Media Catalog V3.12.1 — Negima targeted root + ScanReview lifecycle

Changes vs V3.12:
- Targeted series rescan now detects a season folder directly under the scan root when a valid tvshow.nfo identifies that root. This fixes Negima: root/Saison 1/Mahou Sensei Negima - 01 Fr - ...
- Preserves NFO title/provider IDs when using this targeted-root fallback.
- Resolves OPEN ScanReview ROOT_ERROR rows before deleting empty structural duplicate MediaItems during targeted DEDUP.
- Fixes scripts/backfill-scan-reviews.mjs to use ESM imports consistently.

No Prisma schema change vs V3.12. npx prisma db push is NOT required. Run npx prisma generate only if node_modules/Prisma client was replaced.
