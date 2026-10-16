import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const s = await requireAdminSession(req);
  if (s instanceof NextResponse) return s;
  await db.upcomingRelease.deleteMany({ where: { status: 'UPCOMING', availableAt: { lte: new Date() } } });
  const [items, setting] = await Promise.all([
    db.upcomingRelease.findMany({ orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }] }),
    db.systemSetting.findUnique({ where: { key: 'AUTO_PUBLISH_NEW_MEDIA' } }),
  ]);
  const episodeIds = items.map((x) => x.sourceEpisodeId).filter((x): x is string => Boolean(x));
  const episodeParents = episodeIds.length
    ? await db.episode.findMany({
        where: { id: { in: episodeIds } },
        select: { id: true, mediaItemId: true, seasonNumber: true, episodeNumber: true },
      })
    : [];
  const episodeInfoById = new Map(episodeParents.map((ep) => [ep.id, ep]));

  const normalizedItems = items.map((item) => {
    const episodeInfo = item.sourceEpisodeId
      ? episodeInfoById.get(item.sourceEpisodeId) ?? null
      : null;

    return {
      ...item,
      seriesMediaItemId: episodeInfo?.mediaItemId ?? null,
      seasonNumber: episodeInfo?.seasonNumber ?? item.seasonNumber ?? null,
      episodeNumber: episodeInfo?.episodeNumber ?? item.episodeNumber ?? null,
    };
  });

  return NextResponse.json({
    items: normalizedItems,
    autoPublishNewMedia: setting?.value === 'true',
  });
}

export async function POST(req: NextRequest) {
  const s = await requireAdminSession(req);
  if (s instanceof NextResponse) return s;
  const b = await req.json();
  const item = await db.upcomingRelease.create({
    data: {
      type: ['MOVIE', 'SERIES', 'EPISODE'].includes(b.type) ? b.type : 'MOVIE',
      title: String(b.title),
      subtitle: b.subtitle || null,
      imageUrl: b.imageUrl || null,
      mediaPath: b.mediaPath || null,
      availableAt: b.availableAt ? new Date(b.availableAt) : null,
      publishAt: b.publishAt ? new Date(b.publishAt) : null,
      seasonNumber: b.seasonNumber ? Number(b.seasonNumber) : null,
      episodeNumber: b.episodeNumber ? Number(b.episodeNumber) : null,
      enabled: b.enabled !== false,
      status: b.availableAt ? 'UPCOMING' : 'PENDING',
    },
  });
  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const s = await requireAdminSession(req);
  if (s instanceof NextResponse) return s;
  const b = await req.json();
  if (typeof b.autoPublishNewMedia !== 'boolean') {
    return NextResponse.json({ error: 'autoPublishNewMedia requis' }, { status: 400 });
  }
  await db.systemSetting.upsert({
    where: { key: 'AUTO_PUBLISH_NEW_MEDIA' },
    update: { value: b.autoPublishNewMedia ? 'true' : 'false' },
    create: { key: 'AUTO_PUBLISH_NEW_MEDIA', value: b.autoPublishNewMedia ? 'true' : 'false' },
  });
  return NextResponse.json({ ok: true, autoPublishNewMedia: b.autoPublishNewMedia });
}
