# Media Catalog V3.15.14 — TrickPlay persistant + À suivre

Correctif 14a inclus : le bootstrap TrickPlay ne charge plus les modules Node (`child_process`, `crypto`, `fs/promises`, `path`) directement depuis `instrumentation.ts`. Next 14 analyse aussi l'instrumentation pour Edge et provoquait `UnhandledSchemeError node:*`. Le bootstrap est maintenant déclenché après démarrage par une route interne explicitement `runtime = nodejs`.

Fonctions :
- cache TrickPlay persistant `/var/cache/dreamfilms/trickplay-tiles` ;
- file/cursor persistants ;
- reprise automatique après redémarrage ;
- cache déjà valide ignoré ;
- nouveaux médias d'un scan insérés en priorité ;
- API "À suivre" par profil ;
- une génération de fond à la fois ; les demandes à la volée restent possibles.

Déploiement : extraire à la racine de `/var/www/media-catalog`, supprimer `.next`, puis `npm run build`. Redémarrer PM2 seulement après build réussi.

## V3.15.14b — protection FFmpeg
- timeout FFmpeg par défaut : 15 minutes par média
- configurable avec `TRICKPLAY_FFMPEG_TIMEOUT_MS`
- SIGTERM puis SIGKILL 5 secondes plus tard si FFmpeg reste bloqué
- l'erreur remonte au worker, dont le `finally` avance le curseur persistant et passe au média suivant
- aucun cache TrickPlay valide n'est supprimé
