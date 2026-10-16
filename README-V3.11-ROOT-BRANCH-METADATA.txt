MEDIA-CATALOG V3.11 — ROOT LOCK + PROVIDER BRANCH METADATA

1) Capitaine Flam / racine physique
- Le rescan ciblé donne priorité aux racines canoniques dérivées des fichiers d’épisodes.
- Si tous les épisodes d’une fiche sont sous une unique racine plus précise, le MediaItem existant est déplacé vers cette racine (log [ROOT-LOCK]) au lieu de créer une nouvelle fiche.
- Cas attendu : /Animés/Capitaine Flam -> ...Capitaine.Flam.Integrale... ; Voyage 01..13 restent des conteneurs.

2) Branches TMDB locales (Bleach / TYBW)
- tmdbSeasonNumber pilote maintenant l’API détail : local S01Exx lit la saison fournisseur indiquée (ex. TMDB S02Exx).
- Le poster de la saison fournisseur est persisté sur la fiche de branche lors du rescan.
- matchedTitle est neutralisé sur une branche mappée afin de conserver son titre local distinct dans les listes et détails.
- Les IDs d’épisodes / numéros locaux / chemins physiques ne sont pas modifiés.

Aucun changement Prisma par rapport à V3.10/V3.9.
Déploiement : rm -rf .next && npm run build && pm2 restart media-catalog && pm2 save && pm2 flush
