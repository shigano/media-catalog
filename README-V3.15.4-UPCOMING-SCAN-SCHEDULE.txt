MEDIA CATALOG V3.15.4 — À VENIR / SCAN EN COURS
Date: 05/09/2026

Base : V3.15.2 complète + correctif V3.15.3 Anime NULL filePath.

Corrections « À venir » :
- les épisodes PENDING d'une même série/saison sont regroupés dans une seule carte sur la page web admin ;
- la carte de groupe permet de programmer/publier/masquer tous les épisodes détectés ensemble ;
- si une saison est programmée alors que le scanner continue, les nouveaux épisodes détectés ensuite héritent automatiquement de la même date de sortie ;
- lors du chargement de l'admin, les épisodes déjà PENDING de cette même saison héritent aussi de la programmation existante ;
- évite donc que la fin d'un scan fasse réapparaître les épisodes un par un après avoir programmé la saison.

Aucune migration Prisma supplémentaire nécessaire.
Les fichiers TypeScript/TSX modifiés ont passé une vérification syntaxique locale via TypeScript transpileModule.
Le build Next.js complet n'a pas été exécuté dans l'environnement de génération de l'archive.
