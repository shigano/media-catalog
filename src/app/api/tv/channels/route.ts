import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;
  const channels = await db.tvChannel.findMany({
    where: { isActive: true },
    orderBy: [{ number: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, number: true, category: true,
      logoUrl: true, sourceType: true, sourceUrl: true, epgId: true },
  });
  return NextResponse.json({ channels });
}
