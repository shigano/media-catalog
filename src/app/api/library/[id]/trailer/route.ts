import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';
import { env } from '@/lib/config';

// Renvoie uniquement une bande-annonce officielle YouTube pour un titre
// déjà présent dans la bibliothèque, sans exposer la clé TMDB au client.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const item = await db.mediaItem.findUnique({
    where: { id: params.id },
    select: { id: true, tmdbId: true, type: true, matchStatus: true, libraryId: true, filePath: true, episodes: { select: { id: true } } },
  });
  if (!item || !item.tmdbId ||
      (item.matchStatus !== 'MATCHED' && session.role !== 'ADMIN')) {
    return NextResponse.json({ url: null });
  }

  // Respecter les restrictions de publication appliquees par la route
  // /api/library/[id] : une bande-annonce ne doit pas reveler un titre masque.
  if (session.role !== 'ADMIN') {
    const now = new Date();
    const blocked = await db.upcomingRelease.findFirst({
      where: {
        AND: [
          { OR: [
            { status: 'PENDING' },
            { status: 'HIDDEN' },
            { status: 'UPCOMING', availableAt: { gt: now } },
          ] },
          { OR: [
            { sourceMediaItemId: item.id },
            { sourceEpisodeId: { in: item.episodes.map((ep) => ep.id) } },
            ...(item.filePath ? [{ mediaPath: item.filePath }] : []),
          ] },
        ],
      },
      select: { sourceMediaItemId: true },
    });
    if (blocked?.sourceMediaItemId === item.id) {
      return NextResponse.json({ url: null });
    }
  }

  const profileId = new URL(req.url).searchParams.get('profileId');
  if (profileId && item.libraryId) {
    const profile = await db.profile.findUnique({
      where: { id: profileId },
      select: { userId: true, restrictedLibraryIds: true },
    });
    if (!profile || profile.userId !== session.userId) return NextResponse.json({ url: null });
    const restricted = profile.restrictedLibraryIds?.split(',').filter(Boolean) ?? [];
    if (restricted.includes(item.libraryId)) return NextResponse.json({ url: null });
  }

  try {
    const type = item.type === 'SERIES' ? 'tv' : 'movie';
    const url = new URL(`https://api.themoviedb.org/3/${type}/${item.tmdbId}/videos`);
    url.searchParams.set('api_key', env.tmdbApiKey());
    url.searchParams.set('language', 'fr-FR');
    const load = async (lang: string) => {
      url.searchParams.set('language', lang);
      const response = await fetch(url.toString(), { next: { revalidate: 21600 } });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.results) ? data.results : [];
    };
    const videos = [...await load('fr-FR'), ...await load('en-US')];
    const video = videos.find((v) =>
      v.site === 'YouTube' && v.type === 'Trailer' && v.official === true &&
      /^[A-Za-z0-9_-]{11}$/.test(v.key)) ??
      videos.find((v) =>
        v.site === 'YouTube' && v.type === 'Trailer' &&
        /^[A-Za-z0-9_-]{11}$/.test(v.key));
    return NextResponse.json({
      url: video ? `https://www.youtube.com/watch?v=${video.key}` : null,
    });
  } catch {
    return NextResponse.json({ url: null });
  }
}
