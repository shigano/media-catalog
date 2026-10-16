MEDIA-CATALOG V3.9 — PROVIDER SEASON MAP
========================================

Objectif
--------
Conserver une branche physique comme MediaItem indépendant tout en la reliant
à une saison précise de la série TMDB, sans jamais fusionner les dossiers.

Cas de validation :
- /Bleach -> MediaItem local Bleach, 366 épisodes
- /Bleach La Guerre Sanglante de Mille Ans -> MediaItem local séparé, 40 épisodes
- les deux peuvent partager tmdbId=30984
- la branche TYBW peut utiliser tmdbSeasonNumber=2 pour ses métadonnées épisode

Nouveautés
----------
1. MediaItem.tmdbSeasonNumber Int? (nouveau champ Prisma)
   - null = fonctionnement classique, saisons locales = saisons TMDB
   - N = cette fiche physique représente la saison TMDB N

2. Sécurité des séries manuallyVerified
   - suppression de l'ancien upsert update:{filePath}
   - un autre fichier au même SxxExx n'est jamais écrasé
   - log [MANUAL-EPISODE-COLLISION]

3. Métadonnées d'épisodes pour les branches
   - si tmdbSeasonNumber est défini, les métadonnées viennent de cette saison TMDB
   - la numérotation locale reste inchangée
   - si le nombre de fichiers est identique au nombre d'épisodes TMDB mais que
     la numérotation locale comporte un trou/décalage, appariement ordinal sûr
     et log [TMDB-BRANCH-ORDINAL]

4. Series tracking
   - une branche mappée n'est plus comparée à toutes les saisons de la série TMDB
   - évite les faux "épisodes manquants" provenant d'autres branches

Déploiement
-----------
Cette version AJOUTE un champ Prisma : exécuter `npx prisma db push`, puis
`npx prisma generate` avant le build.

Pour TYBW, après déploiement :

node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  await db.mediaItem.update({
    where: { id: 'cmtka2t1b044gucazvod45abz' },
    data: { tmdbSeasonNumber: 2 }
  });
  console.log('TYBW -> TMDB saison 2');
})().finally(() => db.$disconnect());
NODE

Ensuite lancer UNE actualisation ciblée de TYBW et vérifier :
[TMDB-BRANCH-ORDINAL]
[RESCAN-END]
