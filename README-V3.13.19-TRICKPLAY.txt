Media Catalog V3.13.19 — Trickplay

- Ajoute /api/trickplay/movie/:id/:second et /api/trickplay/episode/:id/:second.
- Authentification identique au streaming.
- Extraction JPEG 320px via ffmpeg, arrondie/cachée par pas de 10 secondes.
- Cache par défaut: /tmp/dreamfilms-trickplay (configurable TRICKPLAY_CACHE_DIR).
- Aucun changement Prisma / aucune migration.
- Nécessite ffmpeg sur le VPS (déjà utilisé par le transcodage Media Catalog).
