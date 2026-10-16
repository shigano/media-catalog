MEDIA-CATALOG V3.4 — ANALYSE TYPE JELLYFIN
==========================================

Objectifs de cette version
--------------------------
1. Corriger définitivement les anciens rattachements BDD par chemin physique.
   Après un scan, l'owner détecté pour un fichier vidéo devient autoritaire.
   Log attendu lorsqu'une ancienne ligne est déplacée : [OWNERSHIP-FIX].

2. Le bouton "Actualiser les métadonnées" d'une série réutilise maintenant
   persistItem(), le même moteur de matching/persistance que le scan global.
   Le scan reste ciblé au dossier de regroupement immédiat de la série.

3. Métadonnées locales NFO (Kodi/Jellyfin)
   - tvshow.nfo
   - movie.nfo
   - fichier.nfo adjacent
   - uniqueid TMDB / IMDb / TVDB
   - anciens tags tmdbid / imdbid / tvdbid
   - title / originaltitle / year
   Priorité : ID explicite NFO > ID externe > titre dossier/fichier.

4. Matching multi-signal
   - TMDB reste la source principale.
   - IMDb ID et TVDB ID sont résolus par l'endpoint TMDB /find.
   - Pour une library dont le nom contient Anime/Animé/Animés, AniList est
     interrogé pour obtenir titres anglais, romaji, natif et synonymes.
   - Les saisons trouvées sur le NAS sont comparées aux saisons TMDB.
   - Le score/source/raison sont enregistrés en BDD.

5. Diagnostic d'identification admin
   GET /api/items/{id}/identity
   Renvoie score, source, raison, IDs, NFO, saisons et nombre d'épisodes.

6. Analyse physique du média
   Toujours stockés : taille + date de modification des épisodes.
   Optionnel : ffprobe durée/codecs avec DEEP_MEDIA_ANALYSIS=true dans .env.
   Désactivé par défaut pour ne pas rendre un scan de grosse library très lent.

7. Cache fournisseur
   Table MetadataCache ajoutée comme fondation pour cache persistant provider.

IMPORTANT : schéma Prisma modifié
---------------------------------
Cette version AJOUTE des colonnes et une table. Il faut donc faire db push.

Déploiement conseillé
---------------------
cd /var/www
unzip media-catalog-v3.4-jellyfin-analysis.zip
rsync -av --exclude='.env' /var/www/media-catalog-v3.4-jellyfin-analysis/ /var/www/media-catalog/
cd /var/www/media-catalog
npm install
npx prisma generate
npx prisma db push
npm run build
pm2 restart media-catalog
pm2 save

Option ffprobe profond (.env) :
DEEP_MEDIA_ANALYSIS=true

Test BLEACH
-----------
1. Relancer uniquement la library Animés.
2. Pendant le scan :
   pm2 logs media-catalog --lines 300
3. Chercher :
   [OWNERSHIP-FIX]
   [REASSIGNED]
4. Vérifier ensuite la BDD. Les fichiers sous
   "Bleach La Guerre Sanglante de Mille Ans" ne doivent plus rester associés
   à une fiche différente de celle détectée par leur dossier physique.

Pour tester le scan ciblé ensuite : ouvrir Bleach dans l'app puis
"Actualiser les métadonnées". La route ciblée utilise désormais persistItem().

Remarque NFO importante
-----------------------
Un tvshow.nfo placé dans un dossier de regroupement de franchise n'est PAS
appliqué automatiquement à toutes ses sous-séries. Cela évite qu'un NFO
"Bleach" force aussi "Thousand-Year Blood War" à devenir Bleach.
