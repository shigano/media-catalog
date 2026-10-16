Media Catalog V3.13.3 — nested season target scope fix

Corrige le rescan ciblé quand une ancienne fausse fiche série pointe déjà sous
un dossier Saison/Spéciaux, derrière un ou plusieurs dossiers de release ou
d'épisode (cas Hawkeye Saison_1/[release]/Hawkeye.S01E01).

Le scope ciblé recherche désormais un ancêtre structurel et remonte à la vraie
racine de série avant de lancer le scanner. Cela doit produire une seule série
Hawkeye @ /mnt/nas/Séries/Hawkeye au lieu de six séries par dossier d'épisode.

Aucun changement Prisma. Ne pas lancer prisma db push.
