import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';
import { certificationRank, getTmdbFullDetails } from '@/lib/tmdbMatch';

const BATCH_SIZE = 30;

/**
 * POST /api/admin/enrich
 * Traite un lot d'items reconnus mais pas encore enrichis (casting,
 * appartenance à une saga, note TMDB, durée) — sans ça, ces infos ne se
 * remplissent qu'au fil des consultations individuelles de fiches. Note
 * et durée sont nécessaires pour permettre de trier une médiathèque
 * entière dessus, pas seulement les items déjà consultés. Traite par
 * lots plutôt que tout d'un coup pour rester raisonnable côté API TMDB ;
 * rappelle cette route tant que `remaining > 0` pour tout traiter.
 */
export async function POST(req: Request) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const pending = await db.mediaItem.findMany({
    where: { matchStatus: 'MATCHED', tmdbId: { not: null }, castNames: null },
    select: { id: true, tmdbId: true, type: true },
    take: BATCH_SIZE,
  });

  let processed = 0;
  for (const item of pending) {
    try {
      const details = await getTmdbFullDetails(item.tmdbId!, item.type);
      if (details) {
        await db.mediaItem.update({
          where: { id: item.id },
          data: {
            castNames: details.cast.length > 0 ? details.cast.map((c) => c.name).join(', ') : '',
            tmdbVoteAverage: details.voteAverage,
            runtimeMinutes: details.runtimeMinutes,
            contentRating: details.certification,
            contentRatingRank: certificationRank(details.certification),
            ...(details.collection
              ? {
                  collectionId: details.collection.id,
                  collectionName: details.collection.name,
                  collectionPosterUrl: details.collection.posterUrl,
                }
              : {}),
          },
        });
      } else {
        // Pas de détails trouvables : chaîne vide plutôt que null, pour
        // ne pas retenter cet item indéfiniment à chaque appel.
        await db.mediaItem.update({ where: { id: item.id }, data: { castNames: '' } });
      }
    } catch {
      // On continue le lot même si un item échoue ponctuellement.
    }
    processed += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const remaining = await db.mediaItem.count({
    where: { matchStatus: 'MATCHED', tmdbId: { not: null }, castNames: null },
  });

  return NextResponse.json({ processed, remaining });
}
