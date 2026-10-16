Media Catalog V3 — refresh NAS + performances

CORRECTIONS IMPORTANTES

1. Saisons/épisodes fantômes
L'ancien "Mettre à jour la série" faisait seulement des upserts : un épisode/saison
supprimé ou déplacé du NAS restait donc dans MySQL. La route rescan-episodes compare
maintenant les épisodes détectés aux lignes existantes et supprime les lignes devenues
obsolètes dans le dossier de la série.

2. Scan intelligent
L'ancien smart scan ne déclenchait un scan que si le nombre de fichiers AUGMENTAIT.
Une suppression, un renommage, un déplacement ou une réorganisation Saison 3 -> Saison 2
avec le même nombre de fichiers était invisible.
La V3 mémorise désormais :
- lastKnownFileCount
- lastKnownFingerprint (empreinte SHA-1 des chemins vidéo)
Le scan est lancé dès que le nombre OU l'empreinte change.

3. Nettoyage lors d'un scan complet
Episode.updatedAt permet de savoir quels épisodes n'ont pas été revus pendant le scan.
Les anciens épisodes et leurs données de progression/favoris/marquages sont nettoyés.

4. Performances
- Continuer à regarder : suppression du N+1 SQL (requêtes groupées).
- Préférences profil : requêtes média/épisodes groupées.
- Détails TMDB/saisons/collections mis en cache côté Next.js avec revalidation.

5. Surveillance quasi temps réel
Commande ajoutée :
  npm run scan:watch

Par défaut, elle vérifie les chemins NAS toutes les 60 secondes et ne lance un scan complet
que lorsqu'une modification est détectée. Minimum volontaire : 30 secondes.
Variables optionnelles :
  AUTO_SCAN_INTERVAL_MS=60000
  MEDIA_CATALOG_BASE_URL=http://localhost:3001
Elle utilise AUTO_SCAN_SECRET déjà attendu par /api/scan/auto.

MISE À JOUR DE LA BASE
Deux champs sont ajoutés :
- Episode.updatedAt
- Library.lastKnownFingerprint

Avec le workflow actuel du projet :
  npm install
  npm run db:push
  npx prisma generate
  npm run build

Si Prisma affiche un avertissement de perte de données, NE PAS confirmer et contrôler
la migration avant de continuer.

Le dossier prisma/migrations/20260901_scan_fingerprint contient aussi le SQL correspondant.
