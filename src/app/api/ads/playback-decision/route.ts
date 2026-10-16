import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAccountAdPolicy } from '@/lib/accountAuth';
import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

const Schema = z
  .object({
    profileId: z.string().min(1),
    playbackAttemptId: z.string().min(8).max(128),
    mediaItemId: z.string().min(1).optional(),
    episodeId: z.string().min(1).optional(),
  })
  .refine((v) => Number(Boolean(v.mediaItemId)) + Number(Boolean(v.episodeId)) === 1, {
    message: 'Fournir mediaItemId OU episodeId',
  });

type Decision = {
  shouldShowAd: boolean;
  reason: string;
  counterValue: number | null;
};

/**
 * POST /api/ads/playback-decision
 *
 * Décision serveur avant l'ouverture du lecteur natif.
 * - plans sans pub : toujours false
 * - film : pub selon movieAdEveryStarts (1 = chaque nouveau démarrage)
 * - série : pub selon seriesAdEveryEpisodes (3 = tous les 3 épisodes)
 * - reprise d'un contenu déjà commencé : aucune pub et aucun compteur
 * - playbackAttemptId rend un retry réseau idempotent
 *
 * Le compteur est attaché au compte + profil, donc changer de téléphone/TV
 * ne le remet jamais à zéro.
 */
export async function POST(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Requête invalide', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { profileId, playbackAttemptId, mediaItemId, episodeId } = parsed.data;

  const profile = await db.profile.findUnique({ where: { id: profileId } });
  if (!profile || profile.userId !== session.userId) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }

  // Vérifie que le contenu existe et détecte une reprise à partir de la
  // progression serveur, sans faire confiance au client.
  let isResume = false;
  let kind: 'MOVIE' | 'EPISODE';

  if (mediaItemId) {
    const movie = await db.mediaItem.findUnique({
      where: { id: mediaItemId },
      select: { id: true, type: true },
    });
    if (!movie || movie.type !== 'MOVIE') {
      return NextResponse.json({ error: 'Film introuvable' }, { status: 404 });
    }
    const progress = await db.watchProgress.findUnique({
      where: { profileId_mediaItemId: { profileId, mediaItemId } },
      select: { positionSeconds: true },
    });
    isResume = Boolean(progress && progress.positionSeconds > 0);
    kind = 'MOVIE';
  } else {
    const episode = await db.episode.findUnique({
      where: { id: episodeId! },
      select: { id: true },
    });
    if (!episode) {
      return NextResponse.json({ error: 'Épisode introuvable' }, { status: 404 });
    }
    const progress = await db.watchProgress.findUnique({
      where: { profileId_episodeId: { profileId, episodeId: episodeId! } },
      select: { positionSeconds: true },
    });
    isResume = Boolean(progress && progress.positionSeconds > 0);
    kind = 'EPISODE';
  }

  const policy = await getAccountAdPolicy(session.userId);

  if (!policy.hasAds) {
    return NextResponse.json({
      shouldShowAd: false,
      reason: 'plan-without-ads',
      mediaKind: kind,
      isResume,
      policy,
    });
  }

  if (isResume) {
    return NextResponse.json({
      shouldShowAd: false,
      reason: 'resume',
      mediaKind: kind,
      isResume: true,
      policy,
    });
  }

  const interval =
    kind === 'MOVIE' ? policy.movieAdEveryStarts : policy.seriesAdEveryEpisodes;

  if (!interval) {
    return NextResponse.json({
      shouldShowAd: false,
      reason: 'ads-disabled-for-media-kind',
      mediaKind: kind,
      isResume: false,
      policy,
    });
  }

  const decision = await db.$transaction(async (tx): Promise<Decision> => {
    let state = await tx.adPlaybackState.findUnique({
      where: { userId_profileId: { userId: session.userId, profileId } },
    });

    // Retry du même lancement : renvoie exactement la décision précédente
    // sans incrémenter une seconde fois le compteur.
    if (state?.lastAttemptId === playbackAttemptId && state.lastShouldShowAd != null) {
      return {
        shouldShowAd: state.lastShouldShowAd,
        reason: state.lastReason ?? 'idempotent-retry',
        counterValue: state.lastCounterValue,
      };
    }

    if (!state) {
      state = await tx.adPlaybackState.create({
        data: { userId: session.userId, profileId },
      });
    }

    const current = kind === 'MOVIE' ? state.movieStartsSinceAd : state.episodeStartsSinceAd;
    const next = current + 1;
    const shouldShowAd = next >= interval;
    const storedCounter = shouldShowAd ? 0 : next;
    const reason = shouldShowAd
      ? kind === 'MOVIE'
        ? 'movie-ad-due'
        : 'series-episode-ad-due'
      : kind === 'MOVIE'
        ? 'movie-ad-not-due'
        : 'series-episode-ad-not-due';

    await tx.adPlaybackState.update({
      where: { id: state.id },
      data: {
        ...(kind === 'MOVIE'
          ? { movieStartsSinceAd: storedCounter }
          : { episodeStartsSinceAd: storedCounter }),
        lastAttemptId: playbackAttemptId,
        lastShouldShowAd: shouldShowAd,
        lastReason: reason,
        lastCounterValue: next,
      },
    });

    return { shouldShowAd, reason, counterValue: next };
  });

  return NextResponse.json({
    ...decision,
    mediaKind: kind,
    isResume: false,
    policy,
  });
}
