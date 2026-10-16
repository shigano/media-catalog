import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const ignores = await db.seriesMissingSeasonIgnore.findMany({
    include: {
      mediaItem: {
        select: {
          id: true,
          title: true,
          matchedTitle: true,
          year: true,
          posterUrl: true,
          missingEpisodesData: true,
        },
      },
    },
    orderBy: [
      { mediaItemId: 'asc' },
      { seasonNumber: 'asc' },
    ],
  });

  const items = ignores.map((ignore) => {
    const rawMissing = Array.isArray(ignore.mediaItem.missingEpisodesData)
      ? ignore.mediaItem.missingEpisodesData
      : [];

    const stillMissingCount = rawMissing.filter((value) => {
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value)
      ) {
        return false;
      }

      const episode = value as Record<string, unknown>;
      return episode.seasonNumber === ignore.seasonNumber;
    }).length;

    return {
      id: ignore.id,
      mediaItemId: ignore.mediaItemId,
      seriesTitle: ignore.mediaItem.matchedTitle || ignore.mediaItem.title,
      year: ignore.mediaItem.year,
      posterUrl: ignore.mediaItem.posterUrl,
      seasonNumber: ignore.seasonNumber,
      stillMissingCount,
      createdAt: ignore.createdAt.toISOString(),
    };
  });

  return NextResponse.json({ ignoredSeasons: items });
}
