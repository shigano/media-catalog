import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';
import { findBestTmdbMatch } from '@/lib/tmdbMatch';

/**
 * POST /api/items/[id]/refresh
 * Relance automatiquement la recherche TMDB pour cet item précis, à
 * partir de son titre déjà détecté — équivalent du "Actualiser les
 * métadonnées" de Jellyfin (récupère une affiche manquante, un synopsis
 * mis à jour...), sans passer par une recherche manuelle.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const item = await db.mediaItem.findUnique({ where: { id: params.id } });
  if (!item) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  }

  const match = await findBestTmdbMatch(item.title, item.year, item.type).catch(() => null);
  if (!match) {
    return NextResponse.json({ error: 'Aucune correspondance trouvée sur TMDB' }, { status: 404 });
  }

  const updated = await db.mediaItem.update({
    where: { id: item.id },
    data: {
      tmdbId: match.tmdbId,
      matchedTitle: match.title,
      posterUrl: match.posterUrl,
      overview: match.overview,
      matchStatus: match.confident ? 'MATCHED' : 'AMBIGUOUS',
    },
  });

  return NextResponse.json({
    ok: true,
    item: {
      title: updated.matchedTitle || updated.title,
      posterUrl: updated.posterUrl,
      matchStatus: updated.matchStatus,
    },
  });
}
