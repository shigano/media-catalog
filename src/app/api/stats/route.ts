import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

/**
 * GET /api/stats
 * Nombre de films et de séries disponibles sur le serveur — affiché en
 * tête du panel admin, façon Jellyfin.
 */
export async function GET(req: Request) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const [movieCount, seriesCount] = await Promise.all([
    db.mediaItem.count({ where: { type: 'MOVIE' } }),
    db.mediaItem.count({ where: { type: 'SERIES' } }),
  ]);

  return NextResponse.json({ movieCount, seriesCount });
}
