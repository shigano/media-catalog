import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireActiveSession } from '@/lib/session';
import { endNativePlaybackSession } from '@/lib/streamSessionLimit';

const Schema = z.object({
  sessionId: z.string().min(1),
  deviceId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });

  await endNativePlaybackSession(session.userId, parsed.data.sessionId, parsed.data.deviceId);
  return NextResponse.json({ ok: true });
}
