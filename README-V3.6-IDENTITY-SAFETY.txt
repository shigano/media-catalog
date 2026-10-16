Media Catalog V3.6 — Identity Safety / réparation Bleach

Correctifs principaux :
- 1 dossier logique de série = 1 MediaItem. Plus aucune fusion automatique par tmdbId entre deux folderPath différents.
- Une collision SxxExx ne remplace plus silencieusement le filePath déjà enregistré.
- Les alias AniList trop génériques sont filtrés : un alias "Bleach" ne peut plus faire identifier "Bleach Thousand-Year Blood War" comme le Bleach original.
- L'actualisation ciblée peut inclure le petit conteneur franchise parent (2 à 20 sous-dossiers) sans scanner toute la médiathèque.
- Logs supplémentaires : [TARGET-SCOPE], [EPISODE-COLLISION], [OWNERSHIP-COLLISION].

Pas de changement Prisma : db push inutile.
Déploiement : npm install ; npx prisma generate ; npm run build ; pm2 restart media-catalog ; pm2 save
Puis actualiser UNE fois la fiche Bleach. Le scope doit montrer /Bleach (2004), jamais toute /Animés.
