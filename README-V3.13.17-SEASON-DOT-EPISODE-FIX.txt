Media Catalog V3.13.17 — Season Dot Episode Fix

Base: V3.13.16 (parser 4 chiffres + récupération de coordonnées + métadonnées multi-saisons).
Aucun changement Prisma.

Correction :
- reconnaît le format SS.EE en début de nom lorsque le dossier fournit déjà la saison ;
- ex. /Saison 8/08.13 - titre.avi => S08E13 ;
- exige que SS == saison connue, afin d'éviter une règle générique sur les nombres décimaux ;
- conserve les formats S21E1000, S01E08, 1x08, Episode 08, etc.

Validation recommandée : rescan ciblé Bob l'éponge avant tout nouveau scan global.
