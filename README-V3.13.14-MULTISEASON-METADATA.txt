Media Catalog V3.13.14 — enrichissement TMDB multi-saisons

Base: V3.13.13 validée (scope ciblé Shaman King).

Correctifs:
- Une série verrouillée continue d'enrichir le cache de ses épisodes: le verrou protège l'identité, pas les métadonnées.
- Cache complet par épisode: id TMDB, titre, synopsis, image, date.
- Mapping DIRECT quand SxxExx local correspond à TMDB.
- Mapping ORDINAL uniquement si le découpage local diffère ET si le nombre total d'épisodes locaux == nombre total fournisseur.
  Cas cible: Reborn 203 épisodes découpés en 8 saisons locales alors que TMDB peut utiliser un autre découpage.
- Aucun mapping ordinal partiel: évite les remappages dangereux sur Sonic/Bleach/etc.
- Auto-lock renforcé: exige matchStatus MATCHED ET tmdbEpisodeId sur tous les épisodes.
- Les branches tmdbSeasonNumber explicites (ex. TYBW) conservent leur logique dédiée.

Aucun changement Prisma/schema.
