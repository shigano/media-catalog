Media Catalog V3.11.1 - Build Fix

Correction TypeScript dans src/app/api/library/route.ts :
- tmdbSeasonNumber est maintenant inclus dans le select Prisma utilisé par GET /api/library.
- Cela corrige l'erreur Next.js/TypeScript : Property 'tmdbSeasonNumber' does not exist on type ...

Aucun changement de schema Prisma par rapport a V3.11.
