Media Catalog V3.13.8 — Ready for Love 2 + Shaman King root repair

1. Ready for Love 2
- Le retrait d'un suffixe numérique reste utilisable pour découvrir des candidats TMDB,
  mais n'est plus autorisé à donner un score parfait à la série précédente.
- Alias vérifié strict : Ready for Love 2 -> Marry Me Again, année 2025.
- Le match attendu est TMDB 286445 (31 épisodes).

2. Shaman King (2021) sous /mnt/nas/Animés
- Un dossier de release directement sous une racine de médiathèque et contenant S01
  peut désormais être reconnu comme racine de série s'il contient un vrai titre.
- Les conteneurs purs Saison 1 / Season 1 / S01 restent structurels.
- Le root lock du rescan ciblé peut donc déplacer la fausse fiche Animés vers le dossier
  Shaman King sans recréer /mnt/nas/Animés comme série.

Aucun changement Prisma. Ne pas exécuter prisma db push.
