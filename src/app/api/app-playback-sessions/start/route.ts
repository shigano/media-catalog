import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireActiveSession } from '@/lib/session';
import { startNativePlaybackSession } from '@/lib/streamSessionLimit';

const Schema = z.object({
  deviceId: z.string().min(8).max(200),
  platform: z.enum(['windows', 'android_mobile', 'android_tv']),
  deviceName: z.string().min(1).max(200),
  profileId: z.string().max(200).optional(),
  mediaItemId: z.string().max(200).optional(),
  episodeId: z.string().max(200).optional(),
  title: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  if (req.headers.get('x-dreamfilms-client') !== 'native-app') {
    return NextResponse.json({ error: 'Client natif requis' }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  const result = await startNativePlaybackSession(session.userId, parsed.data);
  if (!result.allowed) {
    return NextResponse.json(
      {
        code: 'SCREEN_LIMIT_REACHED',
        message: `Limitation d’écrans atteinte. Votre abonnement autorise ${result.limit} écrans simultanés.`,
        limit: result.limit,
        active: result.active,
      },
      { status: 409 },
    );
  }

  return NextResponse.json(result);
}
