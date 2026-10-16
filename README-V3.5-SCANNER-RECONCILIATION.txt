Dream-Films media-catalog V3.5 — scanner/reconciliation

Corrections basées sur l'export SQL réel du catalogue :

1. NFO série strict
   - Seul tvshow.nfo peut identifier/renommer une série.
   - Un sidecar S01E241.nfo n'est plus utilisé comme identité du MediaItem parent.
   - Les films gardent movie.nfo + sidecar du film.

2. Racine logique de série
   - Les dossiers organisationnels Saison, Voyage, Arc, Cour et packs/Intégrale sont remontés.
   - Capitaine Flam/Voyage 01..13 est regroupé sous une seule racine Capitaine Flam.
   - Une vraie branche telle que "Bleach La Guerre Sanglante de Mille Ans" reste distincte de "Bleach".

3. Clé de détection stable
   - Le regroupement en mémoire utilise le folderPath logique, pas seulement le titre.
   - La fusion BDD par titre seul est supprimée.
   - La fusion multi-emplacement ne se fait qu'avec un match TMDB fort.

4. Matching plus prudent
   - Le titre extrait du fichier est conservé comme alias de recherche (utile pour un dossier FR et un fichier EN).
   - Un candidat ambigu/non reconnu n'applique plus affiche/synopsis/titre/ID TMDB erronés.
   - En cas d'erreur fournisseur temporaire, les métadonnées existantes ne sont pas effacées.

5. Actualisation ciblée
   - /api/items/[id]/rescan-episodes scanne uniquement les racines physiques liées à la fiche et à ses épisodes existants.
   - Exemple Bleach : Bleach + TYBW si des épisodes TYBW sont actuellement mal rattachés, pas toute la médiathèque Animés.
   - Réconciliation par filePath et suppression des anciennes fiches vides non vérifiées dans ce périmètre.

6. Compatibilité anciennes applis
   - POST /api/items/[id]/refresh devient un no-op pour SERIES ; l'identité série est gérée par le rescan ciblé.
   - Les anciennes apps qui appellent refresh puis rescan ne corrompent donc plus la série avant le rescan.

7. Conserve les changements V3.4.1, notamment les lectures simultanées illimitées.

Déploiement :
  rsync -av --exclude='.env' media-catalog-v3.5-scanner-reconciliation/ /var/www/media-catalog/
  cd /var/www/media-catalog
  npm install
  npx prisma generate
  npm run build
  pm2 restart media-catalog
  pm2 save

Aucun nouveau changement Prisma spécifique à V3.5 : si V3.4/V3.4.1 a déjà fait db push, pas besoin de db push pour cette version.

Test recommandé :
  1) ne pas lancer un scan complet ;
  2) ouvrir Bleach ;
  3) Actualiser les métadonnées ;
  4) surveiller pm2 logs media-catalog --lines 200 ;
  5) vérifier scanRoots / OWNERSHIP-FIX / DEDUP.
