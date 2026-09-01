import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireActiveSession } from '@/lib/session';
import { endStreamSession } from '@/lib/streamSessionLimit';

const Schema = z.object({ deviceSessionId: z.string().min(1) });

/**
 * POST /api/stream-session/end
 * Libère immédiatement la place occupée par cet appareil dans le compte
 * d'écrans simultanés — appelé en quittant proprement le lecteur, pour
 * ne pas obliger l'utilisateur (ou un autre appareil) à attendre le
 * délai d'expiration du battement de cœur avant de pouvoir relancer une
 * lecture ailleurs.
 */
export async function POST(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  await endStreamSession(session.userId, parsed.data.deviceSessionId);
  return NextResponse.json({ ok: true });
}
