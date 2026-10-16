V3.13.11 — verrouillage automatique des métadonnées
- Film MATCHED + TMDB + affiche + synopsis : verrouillage automatique.
- Série MATCHED + TMDB + affiche + synopsis + tous les épisodes MATCHED : verrouillage automatique.
- Le verrouillage empêche les scans futurs de réidentifier/renommer/changer l'affiche/synopsis.
- Une série verrouillée continue de scanner ses fichiers/épisodes.
- Nom, synopsis, vignette et date TMDB des épisodes sont maintenant mis en cache pendant le scan.
- La fiche d'une série verrouillée utilise le cache épisode et évite les appels TMDB saison inutiles.
- Le bouton/API de déverrouillage existant reste disponible pour forcer une future réanalyse.
IMPORTANT: nouveaux champs Episode => appliquer la migration Prisma avant mise en production.
