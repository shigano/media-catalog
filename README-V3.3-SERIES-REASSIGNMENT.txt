Media Catalog V3.3 — Réaffectation immédiate des épisodes entre séries

Correction principale :
- conserve la séparation de séries ajoutée en V3.2 (dossier parent direct pour les fichiers SxxExx) ;
- pendant un scan complet, si un même filePath existe déjà sous une autre MediaItem,
  la ligne Episode est déplacée vers la nouvelle série au lieu d'attendre uniquement
  le nettoyage des entrées obsolètes ;
- l'ID Episode est conservé lorsque possible, afin de préserver l'historique associé ;
- log serveur [REASSIGNED] lors d'une migration de fichier.

Déploiement conseillé : copier LE CONTENU de ce dossier à la racine de
/var/www/media-catalog (ne pas laisser un sous-dossier v3.3 dans le projet), puis :
npm install
npx prisma generate
npm run build
pm2 restart media-catalog
pm2 save

Aucun prisma db push nécessaire.
