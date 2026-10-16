import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

type IgnoreSeasonBody = {
  mediaItemId?: string;
  seasonNumber?: number;
};

function validCoordinate(body: IgnoreSeasonBody) {
  return (
    typeof body.mediaItemId === 'string' &&
    body.mediaItemId.length > 0 &&
    Number.isInteger(body.seasonNumber) &&
    (body.seasonNumber ?? -1) >= 0
  );
}

// POST = masquer durablement tous les épisodes manquants d'une saison.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const body = (await req.json().catch(() => null)) as IgnoreSeasonBody | null;

  if (!body || !validCoordinate(body)) {
    return NextResponse.json(
      { error: 'mediaItemId et seasonNumber invalides' },
      { status: 400 },
    );
  }

  const mediaItemId = body.mediaItemId!;
  const seasonNumber = body.seasonNumber!;

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

  const missingInSeason = missing.filter(
    (episode) => episode.seasonNumber === seasonNumber,
  );

  if (missingInSeason.length === 0) {
    return NextResponse.json(
      { error: "Cette saison n'a aucun épisode actuellement signalé comme manquant" },
      { status: 409 },
    );
  }

  await db.seriesMissingSeasonIgnore.upsert({
    where: {
      mediaItemId_seasonNumber: {
        mediaItemId,
        seasonNumber,
      },
    },
    create: {
      mediaItemId,
      seasonNumber,
    },
    update: {},
  });

  return NextResponse.json({
    ok: true,
    ignored: true,
    mediaItemId,
    seasonNumber,
    ignoredEpisodesCount: missingInSeason.length,
  });
}

// DELETE = réafficher une saison précédemment ignorée.
export async function DELETE(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const body = (await req.json().catch(() => null)) as IgnoreSeasonBody | null;

  if (!body || !validCoordinate(body)) {
    return NextResponse.json(
      { error: 'mediaItemId et seasonNumber invalides' },
      { status: 400 },
    );
  }

  const mediaItemId = body.mediaItemId!;
  const seasonNumber = body.seasonNumber!;

  await db.seriesMissingSeasonIgnore.deleteMany({
    where: {
      mediaItemId,
      seasonNumber,
    },
  });

  return NextResponse.json({
    ok: true,
    ignored: false,
    mediaItemId,
    seasonNumber,
  });
}
