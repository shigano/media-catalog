MEDIA-CATALOG V3.2 — CORRECTION REGROUPEMENT DES SERIES
======================================================

Correction : lorsqu'un fichier contient deja un motif SxxExx, le scanner
utilise maintenant en priorite le dossier parent direct comme identite de
serie. Le grand-parent n'est plus prioritaire.

Exemple corrige :
  Bleach (2004)/Bleach/...S01E01.mkv
  Bleach (2004)/Bleach La Guerre Sanglante de Mille Ans/...S03E01.mkv

Avant : les deux branches pouvaient etre fusionnees sous Bleach.
Apres : chaque sous-dossier de serie est detecte independamment.

IMPORTANT APRES DEPLOIEMENT
---------------------------
Lancer UN SCAN COMPLET de la mediatheque Animes. Le scan complet va :
- recreer/mettre a jour la fiche distincte de Bleach Thousand-Year Blood War ;
- rattacher ses episodes a cette fiche ;
- nettoyer de Bleach les anciens episodes Saison 3 qui ne sont plus revus
  sur cette fiche pendant le scan.

Aucune migration Prisma n'est necessaire.
