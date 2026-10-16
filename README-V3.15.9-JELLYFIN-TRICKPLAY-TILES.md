# Media Catalog V3.15.9 — TrickPlay pré-généré façon Jellyfin

- Remplace la génération FFmpeg d’une image à chaque position par des planches JPEG 10x10 pré-générées.
- Intervalle : 10 s, cellule : 320x180, 100 aperçus par planche.
- Le client charge une planche puis recadre localement : aucun HTTP/FFmpeg à chaque mouvement du curseur.
- Génération non bloquante et basse priorité (`nice -n 10`), déclenchée au démarrage d’une lecture si absente.
- Extraction keyframes-only pour accélérer fortement la préparation.
- Cache par signature chemin/taille/mtime : une vidéo modifiée invalide automatiquement ses anciennes planches.
- Anciennes routes `/api/trickplay/.../[second]` conservées pour compatibilité.
- Aucune migration Prisma.
