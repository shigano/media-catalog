import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { getContinueWatching } from '@/lib/profilePersonalization';
import { requireActiveSession } from '@/lib/session';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const profile = await db.profile.findUnique({ where: { id: params.id } });
  if (!profile || profile.userId !== session.userId) {
    return NextResponse.json({ error: 'Profil introuvable' }, { status: 404 });
  }

  const items = await getContinueWatching(profile.id);
  return NextResponse.json({ items });
}
