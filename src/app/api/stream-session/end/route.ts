import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

const Schema = z.object({ deviceSessionId: z.string().min(1) });

export async function POST(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  await db.activeStreamSession.deleteMany({
    where: { userId: session.userId, deviceSessionId: parsed.data.deviceSessionId },
  });
  return NextResponse.json({ ok: true });
}
