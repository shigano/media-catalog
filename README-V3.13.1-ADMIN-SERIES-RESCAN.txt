Dream-Films Media Catalog V3.13.1 — Admin Series Rescan
========================================================

Objectif
--------
Corriger le bouton "Actualiser" de l'administration pour les SERIES et
réparer les faux MediaItem créés à partir de dossiers structurels.

Corrections
-----------
1. /api/items/[id]/refresh délègue réellement une SERIES au rescan ciblé
   /rescan-episodes. Avant V3.13.1, l'admin recevait un succès no-op.

2. Le scanner ciblé peut utiliser le nom de la racine ciblée comme identité
   de série même sans tvshow.nfo, uniquement lorsque cette racine se trouve
   SOUS une racine de médiathèque. Cela couvre notamment :
   - Noob/NOOB - saison X - HD
   - Echo/Saison_1
   - Hawkeye/Saison_1
   - dossiers Épisodes spéciaux
   - vraies séries sans tvshow.nfo comme Perdu dans l'espace / Ready for Love

3. Sécurité racine de médiathèque : une racine telle que /mnt/nas/Animés ne
   peut toujours pas être utilisée comme nom de série. Le faux MediaItem
   "Animés" ne doit donc pas entraîner un rescan de toute la bibliothèque.

4. Lorsqu'un faux MediaItem structurel devient vide et est supprimé après
   réaffectation de ses épisodes, ses ScanReview OPEN de type ROOT_ERROR,
   NO_MATCH ou TITLE_AMBIGUITY sont clôturés avant suppression.

Aucun changement de schema Prisma.
NE PAS lancer `npx prisma db push` pour cette version.

Test recommandé après déploiement
---------------------------------
Commencer par cliquer Actualiser sur un seul "NOOB HD".
Attendre dans PM2 :
  [SERIES-REFRESH-DELEGATE]
  [RESCAN-START]
  [RESCAN-DETECTED] 1 série(s): Noob @ .../Séries/Noob
  [RESCAN-PHASE1]
  [RESCAN-PHASE2]
  [DEDUP] ...
  [RESCAN-END]

Vérifier ensuite que les différentes fiches NOOB HD sont consolidées avant
de tester Épisodes spéciaux, Saison 1 (Echo/Hawkeye), puis les vraies séries
non identifiées.
