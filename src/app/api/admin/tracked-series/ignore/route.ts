import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

type IgnoreBody = {
  mediaItemId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
};

function validCoordinate(body: IgnoreBody) {
  return (
    typeof body.mediaItemId === 'string' &&
    body.mediaItemId.length > 0 &&
    Number.isInteger(body.seasonNumber) &&
    Number.isInteger(body.episodeNumber) &&
    (body.seasonNumber ?? -1) >= 0 &&
    (body.episodeNumber ?? 0) > 0
  );
}

// POST = masquer durablement un épisode manquant du panel.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const body = (await req.json().catch(() => null)) as IgnoreBody | null;

  if (!body || !validCoordinate(body)) {
    return NextResponse.json(
      { error: 'mediaItemId, seasonNumber et episodeNumber invalides' },
      { status: 400 },
    );
  }

  const mediaItemId = body.mediaItemId!;
  const seasonNumber = body.seasonNumber!;
  const episodeNumber = body.episodeNumber!;

  const item = await db.mediaItem.findFirst({
    where: {
      id: mediaItemId,
      type: 'SERIES',
      matchStatus: 'MATCHED',
    },
    select: {
      id: true,
      missingEpisodesData: true,
    },
  });

  if (!item) {
    return NextResponse.json({ error: 'Série introuvable' }, { status: 404 });
  }

  const missing =
    (item.missingEpisodesData as Array<{
      seasonNumber: number;
      episodeNumber: number;
    }> | null) ?? [];

  const reallyMissing = missing.some(
    (episode) =>
      episode.seasonNumber === seasonNumber &&
      episode.episodeNumber === episodeNumber,
  );

  if (!reallyMissing) {
    return NextResponse.json(
      { error: "Cet épisode n'est pas actuellement signalé comme manquant" },
      { status: 409 },
    );
  }

  await db.seriesMissingEpisodeIgnore.upsert({
    where: {
      mediaItemId_seasonNumber_episodeNumber: {
        mediaItemId,
        seasonNumber,
        episodeNumber,
      },
    },
    create: {
      mediaItemId,
      seasonNumber,
      episodeNumber,
    },
    update: {},
  });

  return NextResponse.json({
    ok: true,
    ignored: true,
    mediaItemId,
    seasonNumber,
    episodeNumber,
  });
}

// DELETE = réafficher un épisode précédemment ignoré.
export async function DELETE(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const body = (await req.json().catch(() => null)) as IgnoreBody | null;

  if (!body || !validCoordinate(body)) {
    return NextResponse.json(
      { error: 'mediaItemId, seasonNumber et episodeNumber invalides' },
      { status: 400 },
    );
  }

  const mediaItemId = body.mediaItemId!;
  const seasonNumber = body.seasonNumber!;
  const episodeNumber = body.episodeNumber!;

  await db.seriesMissingEpisodeIgnore.deleteMany({
    where: {
      mediaItemId,
      seasonNumber,
      episodeNumber,
    },
  });

  return NextResponse.json({
    ok: true,
    ignored: false,
    mediaItemId,
    seasonNumber,
    episodeNumber,
  });
}
