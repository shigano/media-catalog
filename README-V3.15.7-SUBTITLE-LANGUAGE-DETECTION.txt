Media Catalog V3.15.7

- Conserve le regroupement de séries V3.15.6.
- Si ffprobe ne fournit aucun tag language/title pour une piste de sous-titres texte, extrait jusqu a 180 s de cette piste avec ffmpeg sans decoder la video.
- Detection heuristique des langues fr/en/es/de/it/pt et scripts ja/ko/zh.
- La langue détectée est renvoyée dans la même API /api/tracks/*, donc aucune migration Prisma.
- Cache HTTP des pistes inchangé.
