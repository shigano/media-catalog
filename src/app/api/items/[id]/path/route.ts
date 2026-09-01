import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

/**
 * GET /api/items/[id]/path
 * Chemin du fichier (ou dossier, pour une série) — utile pour une
 * recherche manuelle sur IMDB/TMDB quand la reconnaissance automatique
 * échoue. Réservé aux admins : c'est une info interne au serveur, pas
 * quelque chose à exposer à un abonné normal.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const item = await db.mediaItem.findUnique({
    where: { id: params.id },
    select: { filePath: true, folderPath: true },
  });
  if (!item) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  }

  return NextResponse.json({ filePath: item.filePath, folderPath: item.folderPath });
}
