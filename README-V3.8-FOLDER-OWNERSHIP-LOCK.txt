Media Catalog V3.8 — Folder Ownership Lock
==========================================

Objectif
--------
Empêcher définitivement le retour du mélange entre deux séries physiques
sœurs, même si TMDB/AniList ou un alias de nom de fichier les rapprochent.

Corrections V3.8
----------------
1. Identité locale prioritaire
   - un dossier logique de série reste le propriétaire de ses épisodes ;
   - les alias trop génériques qui ne conservent pas assez des mots distinctifs
     du titre physique ne participent plus à la reconnaissance automatique.

2. Réconciliation ciblée auto-réparatrice
   - si le même fichier physique existe sous le bon MediaItem ET sous un ancien
     MediaItem, la ligne de l'ancien propriétaire est reconnue comme doublon ;
   - ses relations de progression/favoris/marqueurs sont nettoyées ;
   - le doublon Episode est supprimé ;
   - log: [OWNERSHIP-DEDUP].

3. Les protections V3.6/V3.7 restent actives
   - [EPISODE-COLLISION] n'écrase jamais un fichier différent ;
   - deux passes ciblées ;
   - [TARGET-SCOPE], [OWNERSHIP-FIX], [RESCAN-END].

Aucune modification du schéma Prisma.
Pas de `prisma db push` requis.

Après déploiement, vérifier :
  grep -R -n "OWNERSHIP-DEDUP\|VERROU D'IDENTITÉ PHYSIQUE" src
