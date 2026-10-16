import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireActiveSession } from '@/lib/session';
import { heartbeatNativePlaybackSession } from '@/lib/streamSessionLimit';

const Schema = z.object({
  sessionId: z.string().min(1),
  deviceId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

  const result = await heartbeatNativePlaybackSession(
    session.userId,
    parsed.data.sessionId,
    parsed.data.deviceId,
  );

  if (!result.ok) {
    // Seule une révocation volontaire depuis le compte peut demander l'arrêt
    // du lecteur. Une session manquante/expirée est simplement considérée
    // comme inactive : la lecture déjà lancée continue.
    if (result.reason === 'revoked') {
      return NextResponse.json(
        { code: 'SESSION_REVOKED', message: 'Cet écran a été déconnecté depuis votre compte.' },
        { status: 410 },
      );
    }
    return NextResponse.json({ ok: false, stale: true, code: 'SESSION_STALE' });
  }

  return NextResponse.json({ ok: true });
}
