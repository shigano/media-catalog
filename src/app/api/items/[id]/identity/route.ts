import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

/** Diagnostic lisible "Pourquoi ce média a été identifié ainsi ?". */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;
  const item = await db.mediaItem.findUnique({
    where: { id: params.id },
    include: { episodes: { orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }] } },
  });
  if (!item) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });
  return NextResponse.json({
    id: item.id,
    detectedTitle: item.title,
    matchedTitle: item.matchedTitle,
    status: item.matchStatus,
    score: item.identificationScore,
    source: item.metadataSource,
    reason: item.identificationReason,
    ids: { tmdb: item.tmdbId, tmdbSeason: item.tmdbSeasonNumber, imdb: item.imdbId, tvdb: item.tvdbId },
    nfoPath: item.localNfoPath,
    folderPath: item.folderPath,
    episodeCount: item.episodes.length,
    seasons: [...new Set(item.episodes.map((e) => e.seasonNumber))],
  });
}
