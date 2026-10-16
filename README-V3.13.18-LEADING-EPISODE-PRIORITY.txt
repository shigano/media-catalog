Media Catalog V3.13.18 - Leading episode priority

Correctif ciblé du parseur d'épisodes dans les dossiers Saison X.

Problème observé avec Bob l'éponge Saison 4 :
  01 - Ouverture non-stop! ... t411.avi
  38 - bouboule ... t411.avi
Le parseur examinait les nombres concaténés (ex. t411) avant le numéro en début
de fichier. Avec knownSeason=4, 411 pouvait être interprété comme S04E11.

Correction :
- après les formats explicites SxxExxxx / NxXXXX et SS.EE,
- le numéro NN placé en début de fichier devient prioritaire,
- la détection concaténée 401/411/etc. reste disponible en dernier recours.

Exemples attendus :
  Saison 4 / 01 - ... t411.avi -> S04E01
  Saison 4 / 38 - ... t411.avi -> S04E38
  Saison 8 / 08.13 - titre.avi -> S08E13 (V3.13.17 conservé)
  S21E1000 -> E1000 (V3.13.16 conservé)

Aucune modification Prisma/schema.
Déploiement : npm install, npx prisma generate, npm run build, puis rescan ciblé.
