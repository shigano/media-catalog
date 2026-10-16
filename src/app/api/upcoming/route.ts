import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const s = await requireActiveSession(req);
  if (s instanceof NextResponse) return s;
  const now = new Date();
  await db.upcomingRelease.deleteMany({ where: { status: 'UPCOMING', availableAt: { lte: now } } });
  const items = await db.upcomingRelease.findMany({
    where: {
      enabled: true,
      status: 'UPCOMING',
      availableAt: { gt: now },
      OR: [{ publishAt: null }, { publishAt: { lte: now } }],
    },
    orderBy: { availableAt: 'asc' },
    take: 30,
  });

  const episodeIds = items.map((x) => x.sourceEpisodeId).filter((x): x is string => Boolean(x));
  const episodeParents = episodeIds.length
    ? await db.episode.findMany({
        where: { id: { in: episodeIds } },
        select: {
          id: true,
          mediaItemId: true,
          seasonNumber: true,
          episodeNumber: true,
          tmdbEpisodeName: true,
          tmdbEpisodeStillUrl: true,
          mediaItem: { select: { title: true, matchedTitle: true, posterUrl: true } },
        },
      })
    : [];
  const byEpisode = new Map(episodeParents.map((ep) => [ep.id, ep]));

  return NextResponse.json({
    items: items.map((item) => {
      const ep = item.sourceEpisodeId ? byEpisode.get(item.sourceEpisodeId) : null;
      return {
        ...item,
        // Pour une sortie EPISODE, le client ouvre la fiche de la série parente.
        sourceMediaItemId: item.sourceMediaItemId ?? ep?.mediaItemId ?? null,
        seasonNumber: item.seasonNumber ?? ep?.seasonNumber ?? null,
        episodeNumber: item.episodeNumber ?? ep?.episodeNumber ?? null,
        subtitle: item.subtitle ?? (ep ? `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}${ep.tmdbEpisodeName ? ` · ${ep.tmdbEpisodeName}` : ''}` : null),
        imageUrl: item.imageUrl ?? ep?.tmdbEpisodeStillUrl ?? ep?.mediaItem.posterUrl ?? null,
      };
    }),
  });
}
