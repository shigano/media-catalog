Media Catalog V3.13.10 — rescan ciblé protégé + récupération Shaman + épisodes 4 chiffres

1) Concurrence scan auto / actualisation manuelle
- Le rescan ciblé SERIES participe désormais à ScanLog.status=running.
- Si un scan complet/auto est déjà actif, le rescan ciblé répond 409 et ne touche rien.
- Tant qu'un rescan ciblé est actif, le scan automatique existant voit un scan "running" et se met en attente/skipped.
- Le ScanLog ciblé passe à done/error à la fin.

2) Fausse fiche racine "Animés"
- Si une fiche pointe exactement sur la racine d'une médiathèque et possède déjà des épisodes,
  le rescan déduit le dossier physique enfant depuis les filePath existants.
- Si TOUS les épisodes convergent vers un seul dossier enfant, seul ce dossier est scanné.
  Cas attendu : /mnt/nas/Animés/Shaman King (2021) S01 MULTi 1080p WEB x264 AAC -Tsundere-Raws (NF)
- Si plusieurs dossiers physiques distincts sont trouvés, le rescan s'arrête en 409 au lieu de scanner toute la médiathèque.
- Si aucun épisode n'est disponible pour déduire une racine sûre, le rescan s'arrête également.
- Le ROOT-LOCK existant peut ensuite déplacer la fiche existante de /mnt/nas/Animés vers la vraie racine Shaman en conservant son id.

3) One Piece / épisodes >= 1000
- Les motifs SxxExxxx, xxXxxxx et Season xx Episode xxxx acceptent maintenant 1 à 4 chiffres d'épisode.
- Tests regex effectués : S21E1000 => 1000, S21E1009 => 1009, S21E1010 => 1010, S01E01 => 1, S01E52 => 52.

Aucune modification Prisma/schema.
NE PAS exécuter `npx prisma db push` pour cette version.

Validation locale assistant :
- Test regex Node effectué avec succès.
- `npx tsc --noEmit` ne peut pas être utilisé comme validation complète dans l'environnement assistant car les node_modules du projet ne sont pas présents ; les erreurs remontées sont des modules/types manquants, pas une erreur de syntaxe de ce patch.

Déploiement recommandé : extraire dans un NOUVEAU dossier, copier .env depuis la prod, npm install, npx prisma generate, npm run build. Basculer le dossier de production uniquement si le build réussit, puis pm2 restart media-catalog et pm2 save.
