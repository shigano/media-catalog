Media Catalog V3.13.9 — classement des alias explicites

Base: V3.13.8.

Correction principale:
- Un alias explicite vérifié (actuellement Ready for Love 2 -> Marry Me Again, 2025)
  mémorise les IDs réellement retournés par TMDB lors de la recherche alias + année.
- Si TMDB retourne la bonne fiche via cet alias mais expose un titre local/original qui
  ne ressemble pas textuellement à l'alias (ex. titre chinois), le candidat n'est plus
  sous-classé.
- Le bonus n'est accordé qu'aux alias explicites et seulement si l'année du résultat
  est cohérente (écart <= 1 an). Les variantes heuristiques génériques n'en bénéficient pas.
- Nouveau log: [IDENTIFY-ALIAS-HIT]

Pas de changement Prisma.
Le correctif Shaman King de V3.13.8 est conservé mais ne doit être testé qu'après Ready.
