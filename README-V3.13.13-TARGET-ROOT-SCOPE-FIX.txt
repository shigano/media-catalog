MEDIA CATALOG V3.13.13 — TARGET ROOT SCOPE FIX

Correction du rescan ciblé d'une fausse fiche située à la racine d'une bibliothèque
(exemple : fiche "Animés" possédant les 52 épisodes de Shaman King 2021).

Problème V3.13.12 :
- TARGET-ROOT-RECOVERY retrouvait correctement le dossier enfant Shaman King (2021)...
- mais addScope() repassait ce chemin dans canonicalTargetScope().
- un nom de release contenant S01 pouvait être considéré comme conteneur structurel ;
  le scope remontait alors à /mnt/nas/Animés et le scanner parcourait 92 séries.

Correction V3.13.13 :
- le dossier retrouvé par TARGET-ROOT-RECOVERY est ajouté EXACTEMENT au scope ;
- aucune canonicalisation n'est appliquée à ce dossier récupéré ;
- l'expansion de franchise est désactivée pour ce cas ;
- un invariant final force ce dossier à rester l'UNIQUE scope du rescan ;
- nouveaux logs : TARGET-ROOT-SCOPE-LOCK et TARGET-ROOT-SCOPE-ENFORCE.

Aucun changement Prisma / base de données.
