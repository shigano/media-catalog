MEDIA CATALOG V3.13 — SCANNER HARDENING

Objectif : réduire les faux positifs structurels et améliorer le nettoyage des noms de release observés après le scan global V3.12.2.

Corrections :
- Les tags de release/site placés en tête de fichier sont retirés avant normalisation (ex. [ Torrent911.ws ] Scream II ...).
- Les dossiers de saison dont le marqueur est noyé dans un nom de pack sont reconnus comme structurels (ex. NOOB - saison 1 - HD).
- "Épisodes spéciaux" / "Special Episodes" sont rattachés à la série parente comme saison spéciale S00.
- Une racine de médiathèque (ex. /mnt/nas/Animés) ne peut plus devenir une série par simple fallback sur le nom de la racine. Une racine ciblée de vraie série reste permise si un tvshow.nfo fournit une identité explicite.
- Avant de supprimer une fiche devenue fantôme, tous ses ScanReview OPEN sont résolus afin d'éviter les diagnostics orphelins après onDelete:SetNull.

Aucun changement du schéma Prisma. Ne pas lancer `prisma db push`.

Déploiement conseillé : construire le nouveau dossier AVANT de remplacer la version active.
