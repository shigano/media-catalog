MEDIA-CATALOG V3.10 — INTEGRALE ROOT LOCK
=========================================

Correctif ciblé après le test réel Capitaine Flam.

PROBLEME V3.9
-------------
Le dossier physique :
  /Capitaine Flam/[ Torrent... ] Capitaine.Flam.Integrale.../
était classé comme simple conteneur uniquement parce que son nom contenait
"Integrale". Lors d'un nouveau rescan, le scanner remontait donc un niveau trop
haut vers /Capitaine Flam et réaffectait les 52 épisodes à une nouvelle fiche
"Capitaine Flam".

SYMPTOME
--------
[REASSIGNED] ... -> Capitaine Flam S01E52
[RESCAN-END] ... series=1 added=0 removed=52

CORRECTION
----------
Les mots Integrale / Complete / Pack / Collection ne suffisent plus, à eux seuls,
à faire d'un dossier un conteneur de série. Les dossiers structurels non ambigus
restent remontés : Saison/Season, Voyage NN, Arc/Partie/Part/Cour, arcs romains.

Ainsi :
  Capitaine.Flam.Integrale.../Voyage 01/...S01E01.mkv
est désormais rattaché de façon stable à :
  Capitaine.Flam.Integrale...
et non au parent /Capitaine Flam.

Bleach/TYBW n'est pas modifié par ce correctif.
Aucun changement Prisma/schema.

DEPLOIEMENT
-----------
1. Remplacer le code par cette version.
2. rm -rf .next
3. npm run build
4. pm2 restart media-catalog
5. pm2 save

Après déploiement, actualiser UNE SEULE FOIS la fiche Capitaine Flam actuellement
visible. Même si la BDD est momentanément revenue à la fiche parent "Capitaine
Flam", le rescan V3.10 détectera la racine Integrale, réaffectera les 52 épisodes
et supprimera l'ancienne fiche vide non manuelle dans le périmètre ciblé.

Résultat attendu :
- une seule fiche Capitaine Flam Integrale
- folderPath = dossier [ Torrent... ] Capitaine.Flam.Integrale...
- 52 épisodes, S01E01..S01E52
- second rescan immédiatement après : added=0 removed=0
