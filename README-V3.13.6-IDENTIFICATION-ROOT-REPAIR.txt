Media Catalog V3.13.6 — Identification + réparation racine

Base: V3.13.5 validée (Hawkeye 6 épisodes, Echo 5 épisodes).

Correctifs:
- TMDB: année entre parenthèses/crochets extraite du titre de série et utilisée comme first_air_date_year.
- TMDB: titre sans année ajouté à la recherche ET au scoring (cas Perdu dans l'espace (1965)).
- TMDB: variante de recherche prudente sans suffixe numérique final 2..9 (cas Ready for Love 2). L'acceptation garde les seuils de confiance existants.
- Le mécanisme V3.13.5 de rescan ciblé/root-lock est conservé pour permettre à l'ancienne fiche racine /mnt/nas/Animés de descendre vers l'unique série physique détectée (Shaman King) sans autoriser Animés elle-même comme série.

Aucun changement Prisma. NE PAS lancer prisma db push.

Validation attendue:
1. Perdu dans l'espace (1965): 1 série, 84 épisodes, MATCHED si TMDB renvoie un candidat suffisamment sûr.
2. Ready for Love 2: 1 série, 31 épisodes; le suffixe 2 sert seulement de variante de recherche.
3. Animés: tester en dernier. Le scan de la racine ne doit jamais produire une série nommée Animés. Il doit détecter Shaman King sous la racine puis ROOT-LOCK l'ancien MediaItem si tous ses 52 épisodes sont sous ce dossier.
