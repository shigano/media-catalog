import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

const Schema = z
  .object({ mediaItemId: z.string().optional(), episodeId: z.string().optional() })
  .refine((d) => Boolean(d.mediaItemId) !== Boolean(d.episodeId), {
    message: 'Fournir mediaItemId OU episodeId, pas les deux',
  });

/**
 * GET /api/profiles/[id]/favorites
 * Liste des favoris du profil — films/séries entières ET épisodes
 * précis, chacun avec de quoi s'afficher (titre, affiche) et, pour un
 * épisode, le repère saison/épisode et le titre de la série parente.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const profile = await db.profile.findUnique({ where: { id: params.id } });
  if (!profile || profile.userId !== session.userId) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }

  const favorites = await db.favorite.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: 'desc' },
  });

  const mediaItemIds = favorites.map((f) => f.mediaItemId).filter((id): id is string => Boolean(id));
  const episodeIds = favorites.map((f) => f.episodeId).filter((id): id is string => Boolean(id));

  const mediaItems = await db.mediaItem.findMany({
    where: { id: { in: mediaItemIds } },
    select: { id: true, type: true, title: true, matchedTitle: true, year: true, posterUrl: true, matchStatus: true },
  });
  const byId = new Map(mediaItems.map((m) => [m.id, m]));

  const episodes = await db.episode.findMany({
    where: { id: { in: episodeIds } },
    include: { mediaItem: { select: { id: true, title: true, matchedTitle: true, posterUrl: true } } },
  });
  const episodeById = new Map(episodes.map((e) => [e.id, e]));

  const items = favorites
    .map((f) => {
      if (f.mediaItemId) {
        const m = byId.get(f.mediaItemId);
        if (!m) return null;
        return {
          kind: 'ITEM' as const,
          id: m.id,
          type: m.type,
          title: m.matchedTitle || m.title,
          year: m.year,
          posterUrl: m.posterUrl,
          matchStatus: m.matchStatus,
        };
      }
      const e = episodeById.get(f.episodeId!);
      if (!e) return null;
      return {
        kind: 'EPISODE' as const,
        id: e.id,
        mediaItemId: e.mediaItem.id,
        seriesTitle: e.mediaItem.matchedTitle || e.mediaItem.title,
        seasonNumber: e.seasonNumber,
        episodeNumber: e.episodeNumber,
        episodeName: e.tmdbEpisodeName,
        posterUrl: e.mediaItem.posterUrl,
        streamUrl: `/api/stream/episode/${e.id}`,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return NextResponse.json({ items });
}

/**
 * POST /api/profiles/[id]/favorites
 * Ajoute un titre OU un épisode précis aux favoris du profil.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const profile = await db.profile.findUnique({ where: { id: params.id } });
  if (!profile || profile.userId !== session.userId) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Requête invalide' }, { status: 400 });
  }

  if (parsed.data.mediaItemId) {
    await db.favorite.upsert({
      where: { profileId_mediaItemId: { profileId: profile.id, mediaItemId: parsed.data.mediaItemId } },
      update: {},
      create: { profileId: profile.id, mediaItemId: parsed.data.mediaItemId },
    });
  } else {
    await db.favorite.upsert({
      where: { profileId_episodeId: { profileId: profile.id, episodeId: parsed.data.episodeId! } },
      update: {},
      create: { profileId: profile.id, episodeId: parsed.data.episodeId },
    });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/profiles/[id]/favorites?mediaItemId=xxx OU ?episodeId=xxx
 * Retire un titre ou un épisode précis des favoris du profil.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const profile = await db.profile.findUnique({ where: { id: params.id } });
  if (!profile || profile.userId !== session.userId) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }

  const mediaItemId = req.nextUrl.searchParams.get('mediaItemId');
  const episodeId = req.nextUrl.searchParams.get('episodeId');
  if (!mediaItemId && !episodeId) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  await db.favorite.deleteMany({
    where: {
      profileId: profile.id,
      ...(mediaItemId ? { mediaItemId } : {}),
      ...(episodeId ? { episodeId } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
