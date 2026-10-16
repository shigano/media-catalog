Media Catalog V3.13.2 — Targeted structural scope fix
=====================================================

Correctif faisant suite aux tests V3.13.1 sur Echo/Hawkeye.

Problème observé
----------------
- Echo/Saison_1 pouvait rester détecté comme « Saison 1 ».
- Hawkeye/Saison_1 contient un dossier de release puis un dossier par épisode.
  Le rescan ciblé V3.13.1 reconstruisait son scope depuis le parent immédiat
  de chaque fichier et détectait alors 6 séries Hawkeye distinctes.

Correction
----------
1. Quand MediaItem.folderPath est lui-même un dossier structurel
   (Saison_X, Season X, NOOB - saison X - HD, Spéciaux...), le rescan cible
   d'abord sa racine canonique parente et n'utilise plus les dossiers feuille
   de chaque épisode comme racines indépendantes.
2. STRUCTURAL-LIFT déplace l'identité du MediaItem existant depuis le faux
   dossier structurel vers la vraie racine détectée en conservant son id,
   y compris si l'ancien rescan lui a déjà retiré ses épisodes.
3. Les comportements franchise/branches existants restent inchangés lorsque
   folderPath est déjà une vraie racine de série.

Aucun changement Prisma. Ne pas exécuter `npx prisma db push`.
