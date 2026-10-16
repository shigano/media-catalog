Media Catalog V3.15.5

Correctif regroupement / programmation des épisodes :
- UpcomingRelease.sourceMediaItemId reste UNIQUE et n'est plus utilisé comme parent persistant des épisodes.
- La série mère est résolue dynamiquement via UpcomingRelease.sourceEpisodeId -> Episode.mediaItemId.
- La saison et le numéro d'épisode sont aussi résolus depuis Episode, source de vérité.
- L'API admin expose seriesMediaItemId (virtuel) pour grouper l'interface sans modifier la BDD.
- Le regroupement utilise seriesMediaItemId + seasonNumber.
- L'héritage d'une programmation pendant un scan utilise Episode.mediaItemId + Episode.seasonNumber.
- Aucune migration Prisma / SQL requise.
