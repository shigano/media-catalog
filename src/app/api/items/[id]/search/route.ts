import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { env } from '@/lib/config';
import { requireAdminSession } from '@/lib/session';

const IMAGE_BASE = 'https://image.tmdb.org/t/p/w200';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const item = await db.mediaItem.findUnique({ where: { id: params.id } });
  if (!item) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });

  const query = req.nextUrl.searchParams.get('q')?.trim();
  if (!query || query.length < 2) return NextResponse.json({ results: [] });

  const endpoint = item.type === 'MOVIE' ? 'movie' : 'tv';
  const url = new URL(`https://api.themoviedb.org/3/search/${endpoint}`);
  url.searchParams.set('query', query);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('api_key', env.tmdbApiKey());

  const response = await fetch(url.toString());
  const data = await response.json();

  const results = (data.results ?? []).slice(0, 8).map((r: any) => ({
    tmdbId: r.id,
    title: item.type === 'MOVIE' ? r.title : r.name,
    year: (item.type === 'MOVIE' ? r.release_date : r.first_air_date)?.slice(0, 4) || null,
    posterUrl: r.poster_path ? `${IMAGE_BASE}${r.poster_path}` : null,
    overview: r.overview ?? '',
  }));

  return NextResponse.json({ results });
}
