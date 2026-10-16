Media Catalog V3.13.16 — Four Digit Episode Parser Fix

But:
- corriger la voie legacy du scanner qui tronquait encore S21E1000 en E100;
- accepter 1 à 4 chiffres dans les motifs explicites SxxExxxx, SxxXxxxx, NxXXXX et multi-épisodes;
- conserver la récupération de coordonnées DB introduite en V3.13.15.

Cause confirmée sur One Piece:
- scan physique: 1155 fichiers;
- ancien extractEpisodeNumberFromFilenameLegacy: motif glued limité à (\d{1,3});
- S21E1000..1009 entraient donc tous en collision sur S21E100.

Sécurité:
- aucun changement Prisma/schema;
- les collisions existantes restent protégées;
- le mapping TMDB mode NONE reste inchangé lorsque les saisons locales ne correspondent pas au fournisseur.

Test recommandé:
1. déployer V3.13.16;
2. rescan ciblé uniquement de One Piece;
3. vérifier [EPISODE-COORDINATE-RECOVERY] puis 1155 épisodes et S21=197;
4. ne lancer le scan global qu'après validation.
