import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

const Schema = z.object({ name: z.string().min(1).max(300) });

/**
 * PATCH /api/episodes/[id]
 * Correction manuelle du nom affiché d'un épisode précis — remplace
 * définitivement le nom TMDB (voir /api/library/[id], `tmdbEpisodeName`
 * prime toujours quand il est renseigné).
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const episode = await db.episode.findUnique({ where: { id: params.id } });
  if (!episode) {
    return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  await db.episode.update({ where: { id: episode.id }, data: { tmdbEpisodeName: parsed.data.name } });
  return NextResponse.json({ ok: true });
}
