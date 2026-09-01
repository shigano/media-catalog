import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';
import { refreshSeriesTracking } from '@/lib/seriesTracking';

const BATCH_SIZE = 10;
const STALE_CUTOFF_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/admin/tracked-series/refresh
 * Traite un lot de séries dont le suivi (statut/épisodes manquants) n'a
 * jamais été calculé ou date de plus de 24h — même principe que
 * /api/admin/enrich : traite par petits lots pour rester raisonnable
 * côté API TMDB (chaque série peut nécessiter plusieurs appels), rappelle
 * cette route tant que `remaining > 0`. Un lot plus petit qu'ailleurs
 * (10 au lieu de 30) car une série "en retard" peut coûter plusieurs
 * appels TMDB (une saison entière), contrairement à l'enrichissement qui
 * n'en coûte qu'un seul par item.
 */
export async function POST(req: Request) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const staleCutoff = new Date(Date.now() - STALE_CUTOFF_MS);
  const pending = await db.mediaItem.findMany({
    where: {
      type: 'SERIES',
      matchStatus: 'MATCHED',
      tmdbId: { not: null },
      OR: [{ tmdbSeriesStatusCheckedAt: null }, { tmdbSeriesStatusCheckedAt: { lt: staleCutoff } }],
    },
    take: BATCH_SIZE,
  });

  let processed = 0;
  for (const item of pending) {
    try {
      await refreshSeriesTracking({
        id: item.id,
        tmdbId: item.tmdbId!,
        tmdbSeriesStatus: item.tmdbSeriesStatus,
        tmdbNextEpisodeAirDate: item.tmdbNextEpisodeAirDate,
        tmdbNextEpisodeLabel: item.tmdbNextEpisodeLabel,
        missingEpisodesData: item.missingEpisodesData,
      });
    } catch {
      // On continue le lot même si une série échoue ponctuellement.
    }
    processed += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const remaining = await db.mediaItem.count({
    where: {
      type: 'SERIES',
      matchStatus: 'MATCHED',
      tmdbId: { not: null },
      OR: [{ tmdbSeriesStatusCheckedAt: null }, { tmdbSeriesStatusCheckedAt: { lt: staleCutoff } }],
    },
  });

  return NextResponse.json({ processed, remaining });
}
