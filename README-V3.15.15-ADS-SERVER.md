# Media Catalog V3.15.15 — politique pub côté serveur

Ajoute `POST /api/ads/playback-decision` pour le futur plan Dream-Films 7,99 €.

## Règles

- Le plan est lu directement dans la base Account Portal (`Plan.hasAds`, `movieAdEveryStarts`, `seriesAdEveryEpisodes`).
- Un plan sans pub reçoit toujours `shouldShowAd: false`.
- Film : compteur serveur par compte + profil. Avec `movieAdEveryStarts = 1`, une pub est demandée à chaque **nouveau démarrage**.
- Série : compteur serveur par compte + profil. Avec `seriesAdEveryEpisodes = 3`, pub aux épisodes 3, 6, 9...
- Une reprise détectée via `WatchProgress.positionSeconds > 0` ne déclenche aucune pub et ne fait pas avancer le compteur.
- `playbackAttemptId` rend les retries réseau idempotents : un même lancement ne compte qu'une fois.
- Changer de téléphone/TV/Windows ne remet pas les compteurs à zéro.
- Aucun code TrickPlay, scan, stream, Media3 ou limitation d'écrans n'est modifié.

## Exemple requête film

```json
{
  "profileId": "...",
  "playbackAttemptId": "uuid-du-lancement",
  "mediaItemId": "..."
}
```

## Exemple requête épisode

```json
{
  "profileId": "...",
  "playbackAttemptId": "uuid-du-lancement",
  "episodeId": "..."
}
```

## Déploiement

```bash
cd /var/www/media-catalog
npx prisma generate
npx prisma db push
npm run build
pm2 restart media-catalog
```

Après cette étape serveur, l'application Dream-Films devra appeler la route juste avant d'ouvrir le lecteur et afficher un interstitiel AdMob uniquement si `shouldShowAd` vaut `true`.
