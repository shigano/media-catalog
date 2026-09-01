import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';
import type { MissingEpisode } from '@/lib/seriesTracking';

/**
 * GET /api/admin/tracked-series
 * "Séries en cours" au sens pratique : celles où il te MANQUE au moins
 * un épisode déjà diffusé selon TMDB. Lit UNIQUEMENT le cache déjà
 * calculé (rapide, aucun appel TMDB ici) — le calcul lui-même se fait en
 * tâche de fond via POST /api/admin/tracked-series/refresh, pour ne
 * jamais bloquer l'ouverture du panel sur un gros catalogue ni risquer
 * un faux "à jour" en cas de coup de mou de l'API TMDB pendant la
 * requête. Triée par date du prochain épisode connu (le plus proche en
 * premier).
 */
export async function GET(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const series = await db.mediaItem.findMany({
    where: { type: 'SERIES', matchStatus: 'MATCHED', missingEpisodesCount: { gt: 0 } },
    orderBy: { title: 'asc' },
  });

  const results = series.map((item) => ({
    id: item.id,
    title: item.matchedTitle || item.title,
    year: item.year,
    posterUrl: item.posterUrl,
    tmdbStatus: item.tmdbSeriesStatus,
    nextEpisodeAirDate: item.tmdbNextEpisodeAirDate ? item.tmdbNextEpisodeAirDate.toISOString() : null,
    nextEpisodeLabel: item.tmdbNextEpisodeLabel,
    missingEpisodesCount: item.missingEpisodesCount ?? 0,
    missingEpisodes: (item.missingEpisodesData as unknown as MissingEpisode[] | null) ?? [],
  }));

  results.sort((a, b) => {
    if (!a.nextEpisodeAirDate && !b.nextEpisodeAirDate) return a.title.localeCompare(b.title);
    if (!a.nextEpisodeAirDate) return 1;
    if (!b.nextEpisodeAirDate) return -1;
    return a.nextEpisodeAirDate.localeCompare(b.nextEpisodeAirDate);
  });

  // Nombre de séries jamais encore calculées (ou dont le cache a plus de
  // 24h) — permet à l'appli de savoir si elle doit lancer/poursuivre un
  // rafraîchissement en tâche de fond après avoir affiché ce qui est
  // déjà connu.
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pendingRefresh = await db.mediaItem.count({
    where: {
      type: 'SERIES',
      matchStatus: 'MATCHED',
      tmdbId: { not: null },
      OR: [{ tmdbSeriesStatusCheckedAt: null }, { tmdbSeriesStatusCheckedAt: { lt: staleCutoff } }],
    },
  });

  return NextResponse.json({ series: results, pendingRefresh });
}
