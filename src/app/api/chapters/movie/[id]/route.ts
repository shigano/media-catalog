import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';
import { probeChapters } from '@/lib/chapterProbe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const item = await db.mediaItem.findUnique({ where: { id: params.id } });
  if (!item?.filePath) return new Response('Introuvable', { status: 404 });
  if (item.matchStatus !== 'MATCHED' && session.role !== 'ADMIN') {
    return new Response('Introuvable', { status: 404 });
  }

  if (session.role !== 'ADMIN') {
    const now = new Date();
    const blocked = await db.upcomingRelease.findFirst({
      where: {
        AND: [
          { OR: [{ sourceMediaItemId: item.id }, { mediaPath: item.filePath }] },
          { OR: [{ status: 'PENDING' }, { status: 'HIDDEN' }, { status: 'UPCOMING', availableAt: { gt: now } }] },
        ],
      },
    });
    if (blocked) return new Response('Introuvable', { status: 404 });
  }

  const chapters = await probeChapters(item.filePath);
  return NextResponse.json({ chapters }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
}
