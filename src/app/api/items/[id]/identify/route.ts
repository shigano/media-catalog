import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { env } from '@/lib/config';
import { requireAdminSession } from '@/lib/session';

const IMAGE_BASE = 'https://image.tmdb.org/t/p/w200';

/**
 * GET /api/items/[id]/identify?tmdbId=12345
 * Recherche DIRECTE par identifiant TMDB (pas une recherche par mot-clé)
 * — équivalent du champ "Identifier" de Jellyfin, où on colle directement
 * l'id d'une fiche TMDB qu'on a trouvée soi-même. Ne modifie rien, prépare
 * juste le résultat pour confirmation via /rematch.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const item = await db.mediaItem.findUnique({ where: { id: params.id } });
  if (!item) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });

  const tmdbIdParam = req.nextUrl.searchParams.get('tmdbId');
  const tmdbId = tmdbIdParam ? parseInt(tmdbIdParam, 10) : NaN;
  if (!tmdbId || Number.isNaN(tmdbId)) {
    return NextResponse.json({ error: 'Identifiant TMDB invalide' }, { status: 400 });
  }

  const endpoint = item.type === 'MOVIE' ? 'movie' : 'tv';
  const url = new URL(`https://api.themoviedb.org/3/${endpoint}/${tmdbId}`);
  url.searchParams.set('language', 'fr-FR');
  url.searchParams.set('api_key', env.tmdbApiKey());

  const response = await fetch(url.toString());
  if (!response.ok) {
    return NextResponse.json({ error: 'Aucune fiche TMDB avec cet identifiant' }, { status: 404 });
  }
  const r = await response.json();

  return NextResponse.json({
    result: {
      tmdbId: r.id,
      title: item.type === 'MOVIE' ? r.title : r.name,
      year: (item.type === 'MOVIE' ? r.release_date : r.first_air_date)?.slice(0, 4) || null,
      posterUrl: r.poster_path ? `${IMAGE_BASE}${r.poster_path}` : null,
      overview: r.overview ?? '',
    },
  });
}
