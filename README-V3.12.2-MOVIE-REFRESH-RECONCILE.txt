Media Catalog V3.12.2 - Movie Refresh Reconciliation

- Corrige /api/items/[id]/refresh pour les films avec ancien état partiel : tmdbId + matchedTitle présents mais matchStatus AMBIGUOUS et score/reason null.
- Revalide d'abord le tmdbId existant via TMDB avec garde-fou sur la similarité du titre enregistré / local.
- En cas de revalidation : MATCHED, score=1, reason="ID TMDB explicite: <id>", metadataSource=TMDB.
- Ferme automatiquement les ScanReview OPEN de type STALE_IDENTIFICATION / TITLE_AMBIGUITY / NO_MATCH lorsque le film devient MATCHED.
- Ajoute les logs [MOVIE-REFRESH-START], [MOVIE-RECONCILE], [MOVIE-REFRESH-END].
- Aucun changement Prisma par rapport à V3.12/V3.12.1 : ne pas exécuter prisma db push.
