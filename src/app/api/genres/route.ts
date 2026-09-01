import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

/**
 * GET /api/genres
 * Liste des genres réellement présents dans le catalogue (pas la liste
 * complète TMDB — seulement ceux qui concernent au moins un titre déjà
 * détecté), triés par nombre de titres décroissant.
 */
export async function GET(req: Request) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const items = await db.mediaItem.findMany({
    where: { genres: { not: null } },
    select: { genres: true },
  });

  const counts = new Map<string, number>();
  for (const item of items) {
    for (const genre of (item.genres ?? '').split(', ').filter(Boolean)) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }

  const genres = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  return NextResponse.json({ genres });
}
