import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

/**
 * GET /api/libraries?profileId=xxx
 * Liste des médiathèques avec une image représentative (l'affiche du
 * titre le plus récemment ajouté qui en a une) — sert à afficher les
 * grandes tuiles de la page d'accueil, façon Jellyfin. Accessible à tout
 * abonné actif (contrairement à /api/admin/libraries, réservé à l'admin).
 *
 * `profileId`, si fourni, retire de la liste les médiathèques restreintes
 * pour ce profil précis (contrôle parental) — un profil enfant ne voit
 * même pas la tuile "Horreur" si elle a été masquée pour lui.
 */
export async function GET(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const profileId = req.nextUrl.searchParams.get('profileId');
  let restrictedIds: string[] = [];
  if (profileId) {
    const profile = await db.profile.findUnique({ where: { id: profileId }, select: { restrictedLibraryIds: true } });
    restrictedIds = profile?.restrictedLibraryIds?.split(',').filter(Boolean) ?? [];
  }

  const libraries = await db.library.findMany({
    where: restrictedIds.length > 0 ? { id: { notIn: restrictedIds } } : undefined,
    orderBy: { name: 'asc' },
    include: {
      items: {
        where: { posterUrl: { not: null } },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { posterUrl: true },
      },
      _count: { select: { items: true } },
    },
  });

  // Décompte par type en une seule requête groupée — sert côté appli à
  // savoir si le sélecteur Films/Séries a un sens pour cette médiathèque
  // (inutile de le proposer si elle ne contient qu'un seul des deux).
  const typeCounts = await db.mediaItem.groupBy({
    by: ['libraryId', 'type'],
    _count: true,
    where: { libraryId: { not: null } },
  });
  const countsByLibrary = new Map<string, { movieCount: number; seriesCount: number }>();
  for (const row of typeCounts) {
    if (!row.libraryId) continue;
    const entry = countsByLibrary.get(row.libraryId) ?? { movieCount: 0, seriesCount: 0 };
    if (row.type === 'MOVIE') entry.movieCount = row._count;
    if (row.type === 'SERIES') entry.seriesCount = row._count;
    countsByLibrary.set(row.libraryId, entry);
  }

  return NextResponse.json({
    libraries: libraries.map((lib) => ({
      id: lib.id,
      name: lib.name,
      itemCount: lib._count.items,
      coverUrl: lib.items[0]?.posterUrl ?? null,
      movieCount: countsByLibrary.get(lib.id)?.movieCount ?? 0,
      seriesCount: countsByLibrary.get(lib.id)?.seriesCount ?? 0,
    })),
  });
}
