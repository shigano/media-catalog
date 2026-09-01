import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';
import { heartbeatStreamSession } from '@/lib/streamSessionLimit';

const Schema = z.object({
  mediaItemId: z.string().optional(),
  episodeId: z.string().optional(),
  positionSeconds: z.number().int().min(0),
  durationSeconds: z.number().int().min(0).optional(),
  deviceSessionId: z.string().optional(),
});

/**
 * POST /api/profiles/[id]/progress
 * Appelé périodiquement pendant la lecture (toutes les ~15s) pour
 * permettre la reprise et alimenter "Continuer à regarder".
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const profile = await db.profile.findUnique({ where: { id: params.id } });
  if (!profile || profile.userId !== session.userId) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success || (!parsed.data.mediaItemId && !parsed.data.episodeId)) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }
  const { mediaItemId, episodeId, positionSeconds, durationSeconds, deviceSessionId } = parsed.data;

  // Ce rapport périodique (~15s pendant la lecture) sert aussi de
  // battement de cœur pour la limite d'écrans simultanés — évite une
  // route séparée dédiée à ça.
  if (deviceSessionId) {
    await heartbeatStreamSession(session.userId, deviceSessionId).catch(() => null);
  }

  // Terminé (à 30 secondes près de la fin) : on supprime la ligne plutôt
  // que de la garder indéfiniment marquée "terminée" en base — décision
  // explicite plutôt que de ne compter que sur le filtre d'affichage
  // (qui masquait déjà le titre de "Continuer à regarder", mais sans
  // jamais vider la table).
  const isFinished = durationSeconds != null && positionSeconds >= durationSeconds - 30;

  if (mediaItemId) {
    if (isFinished) {
      await db.watchProgress.deleteMany({ where: { profileId: profile.id, mediaItemId } });
      // Marque "vu" persistante — indépendante de la ligne ci-dessus
      // qu'on vient de supprimer, jamais nettoyée automatiquement.
      await db.watchedMark
        .upsert({
          where: { profileId_mediaItemId: { profileId: profile.id, mediaItemId } },
          update: {},
          create: { profileId: profile.id, mediaItemId },
        })
        .catch(() => null);
    } else {
      const existing = await db.watchProgress.findUnique({
        where: { profileId_mediaItemId: { profileId: profile.id, mediaItemId } },
      });
      await db.watchProgress.upsert({
        where: { profileId_mediaItemId: { profileId: profile.id, mediaItemId } },
        update: { positionSeconds, durationSeconds },
        create: { profileId: profile.id, mediaItemId, positionSeconds, durationSeconds },
      });
      // Première fois que CE profil regarde ce titre — compte comme une
      // lecture. Revoir un titre déjà commencé ne recompte pas (upsert
      // met juste à jour la même ligne) : ce n'est pas un vrai compteur
      // de rediffusions, juste "combien de profils l'ont démarré".
      if (!existing) {
        await db.mediaItem.update({ where: { id: mediaItemId }, data: { playCount: { increment: 1 } } }).catch(() => null);
      }
    }
  } else if (episodeId) {
    if (isFinished) {
      await db.watchProgress.deleteMany({ where: { profileId: profile.id, episodeId } });
      await db.watchedMark
        .upsert({
          where: { profileId_episodeId: { profileId: profile.id, episodeId } },
          update: {},
          create: { profileId: profile.id, episodeId },
        })
        .catch(() => null);
    } else {
      const existing = await db.watchProgress.findUnique({
        where: { profileId_episodeId: { profileId: profile.id, episodeId } },
      });
      await db.watchProgress.upsert({
        where: { profileId_episodeId: { profileId: profile.id, episodeId } },
        update: { positionSeconds, durationSeconds },
        create: { profileId: profile.id, episodeId, positionSeconds, durationSeconds },
      });
      if (!existing) {
        const episode = await db.episode.findUnique({ where: { id: episodeId }, select: { mediaItemId: true } });
        if (episode) {
          await db.mediaItem
            .update({ where: { id: episode.mediaItemId }, data: { playCount: { increment: 1 } } })
            .catch(() => null);
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/profiles/[id]/progress?mediaItemId=xxx OU ?episodeId=xxx
 * Retire un titre de "Continuer à regarder" — supprime la progression
 * enregistrée, la reprise repartira du début la prochaine fois.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const profile = await db.profile.findUnique({ where: { id: params.id } });
  if (!profile || profile.userId !== session.userId) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }

  const mediaItemId = req.nextUrl.searchParams.get('mediaItemId');
  const episodeId = req.nextUrl.searchParams.get('episodeId');
  if (!mediaItemId && !episodeId) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  await db.watchProgress.deleteMany({
    where: {
      profileId: profile.id,
      ...(mediaItemId ? { mediaItemId } : {}),
      ...(episodeId ? { episodeId } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
