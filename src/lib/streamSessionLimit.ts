import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';

import { db } from './db';
import { getAccountConcurrentStreamLimit } from './accountAuth';
import type { SessionPayload } from './session';

const SESSION_TTL_MS = 120_000;
const MAX_SERIALIZABLE_RETRIES = 3;

export type NativePlaybackSessionInput = {
  deviceId: string;
  platform: string;
  deviceName: string;
  profileId?: string | null;
  mediaItemId?: string | null;
  episodeId?: string | null;
  title?: string | null;
};

function activeCutoff() {
  return new Date(Date.now() - SESSION_TTL_MS);
}

async function serializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_SERIALIZABLE_RETRIES; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      lastError = error;
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') {
        throw error;
      }
    }
  }
  throw lastError;
}

/**
 * Réserve atomiquement une place de lecture pour une application native.
 * Le site web n'appelle jamais cette fonction et ne compte donc pas comme écran.
 */
export async function startNativePlaybackSession(
  userId: string,
  input: NativePlaybackSessionInput,
) {
  const limit = await getAccountConcurrentStreamLimit(userId);
  const cutoff = activeCutoff();

  return serializable(async (tx) => {
    // Nettoyage opportuniste des sessions abandonnées (app tuée, box coupée...).
    await tx.activeStreamSession.deleteMany({
      where: { userId, lastHeartbeatAt: { lt: cutoff } },
    });

    // Un appareil physique ne réserve qu'une seule place. Une relance du lecteur
    // remplace donc sa précédente session, y compris après une révocation distante.
    await tx.activeStreamSession.deleteMany({
      where: { userId, deviceSessionId: input.deviceId },
    });

    const active = await tx.activeStreamSession.count({
      where: {
        userId,
        revokedAt: null,
        lastHeartbeatAt: { gte: cutoff },
      },
    });

    if (active >= limit) {
      return { allowed: false as const, limit, active };
    }

    const created = await tx.activeStreamSession.create({
      data: {
        userId,
        deviceSessionId: input.deviceId,
        platform: input.platform,
        deviceName: input.deviceName,
        profileId: input.profileId ?? null,
        mediaItemId: input.mediaItemId ?? null,
        episodeId: input.episodeId ?? null,
        title: input.title ?? null,
        lastHeartbeatAt: new Date(),
        revokedAt: null,
      },
    });

    return {
      allowed: true as const,
      sessionId: created.id,
      limit,
      active: active + 1,
    };
  });
}

export async function heartbeatNativePlaybackSession(
  userId: string,
  sessionId: string,
  deviceId: string,
) {
  const session = await db.activeStreamSession.findFirst({
    where: { id: sessionId, userId, deviceSessionId: deviceId },
  });

  if (!session) return { ok: false as const, reason: 'missing' as const };
  if (session.revokedAt) return { ok: false as const, reason: 'revoked' as const };
  if (session.lastHeartbeatAt < activeCutoff()) {
    await db.activeStreamSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return { ok: false as const, reason: 'expired' as const };
  }

  await db.activeStreamSession.update({
    where: { id: session.id },
    data: { lastHeartbeatAt: new Date() },
  });
  return { ok: true as const };
}

export async function endNativePlaybackSession(
  userId: string,
  sessionId: string,
  deviceId: string,
) {
  await db.activeStreamSession.deleteMany({
    where: { id: sessionId, userId, deviceSessionId: deviceId },
  });
}

// Compatibilité avec les anciennes versions qui passent deviceSessionId dans
// l'URL du flux. Le nouveau système V3.15.11 est piloté par les routes
// /api/app-playback-sessions/* ; ces wrappers restent neutres pour ne pas
// double-compter une même lecture.
export async function checkAndRegisterStreamSession(
  _userId: string,
  _deviceSessionId: string,
  _maxConcurrentStreams = Number.MAX_SAFE_INTEGER,
) {
  return { allowed: true };
}

export async function heartbeatStreamSession(_userId: string, _deviceSessionId: string) {}
export async function endStreamSession(_userId: string, _deviceSessionId: string) {}

export async function enforceStreamLimit(
  _req: Request,
  _session: SessionPayload,
): Promise<NextResponse | null> {
  return null;
}
