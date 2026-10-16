Media Catalog V3.13.5 — nested detection dedup

Correctif Hawkeye : après détection, une série descendante est ignorée si tous ses fichiers épisode sont déjà couverts par une série ancêtre détectée. Cela empêche les dossiers release / S01E01 / S01E02... de devenir des propriétaires concurrents lorsque la vraie racine Hawkeye couvre déjà ces fichiers.

Log ajouté : [NESTED-DETECTION-SKIP]
Résultat attendu pour Hawkeye : [RESCAN-DETECTED] 1 série(s): Hawkeye @ /mnt/nas/Séries/Hawkeye

Aucun changement Prisma. Ne pas lancer prisma db push.
