Media Catalog V3.13.12 — Episode-folder root fix

- Corrige les séries dont chaque épisode est rangé dans son propre dossier de release
  portant SxxExxx (ex. Chernobyl.S01E01..., Chernobyl.S01E02...).
- Le scanner remonte désormais ces dossiers feuilles vers leur parent commun.
- Le rescan ciblé compacte les scopes imbriqués et privilégie l'ancêtre commun.
- L'auto-verrouillage refuse défensivement une racine dont le nom ressemble à un épisode.
- Aucun changement Prisma / aucune migration DB.
- Conserve les protections V3.13.11 (scan guard, Shaman root recovery, parser 4 chiffres,
  réaffectation/dédoublonnage, cache métadonnées et auto-lock).
