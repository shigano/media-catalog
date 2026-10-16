Media Catalog V3.7 — Two-Pass Repair
=====================================

Objectif
--------
Réparer en UN seul "Actualiser les métadonnées" les bases déjà corrompues par
une ancienne fusion de deux séries physiques ayant les mêmes numéros SxxExx
(exemple : Bleach et Bleach Thousand-Year Blood War).

Changements
-----------
- Conserve toutes les protections V3.6 : aucune collision ne remplace un autre fichier.
- Première passe : crée/met à jour les MediaItem physiques et réaffecte les fichiers déjà connus.
- Réconciliation par chemin physique.
- Deuxième passe : remplit les SxxExx libérés par les réaffectations de la première passe.
- Logs obligatoires : RESCAN-START, RESCAN-DETECTED, RESCAN-PHASE1, RESCAN-PHASE2, RESCAN-END.

Aucune modification Prisma par rapport à V3.6 : pas de `prisma db push` nécessaire.
