import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;
  const now = new Date();
  const from = new Date(now.getTime() - 3600000);
  const to = new Date(now.getTime() + 86400000);
  const channels = await db.tvChannel.findMany({
    where: { isActive: true },
    orderBy: [{ number: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, number: true, category: true,
      logoUrl: true, sourceType: true, sourceUrl: true, programs: {
        where: { startsAt: { lt: to }, endsAt: { gt: from } },
        orderBy: { startsAt: 'asc' },
        select: { id: true, title: true, description: true, startsAt: true, endsAt: true },
      },
    },
  });
  return NextResponse.json({ channels });
}
