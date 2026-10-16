Media Catalog V3.13.4 — Season ownership fix

Correctif ciblé du cas Hawkeye observé en V3.13.3.

- Quand plusieurs parents portent un marqueur de saison (Saison_1 + dossier release S01),
  le scanner choisit le dossier de saison le plus externe.
- Lorsqu'un dossier de saison est détecté, la racine logique de la série est forcée
  au-dessus de ce dossier. Les dossiers release et les dossiers S01E01/S01E02 placés
  dessous ne peuvent donc plus devenir des séries autonomes.
- Conserve les protections et correctifs des V3.13 à V3.13.3.
- Aucun changement Prisma / aucun db push nécessaire.

Résultat attendu pour Hawkeye :
[RESCAN-DETECTED] 1 série(s): Hawkeye @ /mnt/nas/Séries/Hawkeye
