Media Catalog V3.15.2 — chapitres/segments
==========================================

Ajoute deux endpoints authentifiés :
- GET /api/chapters/movie/[id]
- GET /api/chapters/episode/[id]

Ils utilisent ffprobe -show_chapters pour renvoyer les chapitres réellement
embarqués dans le fichier. Aucune migration Prisma n'est nécessaire.
Les protections "À venir" sont conservées : un contenu non disponible ne peut
pas exposer ses chapitres à un utilisateur normal.
