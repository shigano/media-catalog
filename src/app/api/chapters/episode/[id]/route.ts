import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';
import { probeChapters } from '@/lib/chapterProbe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const episode = await db.episode.findUnique({ where: { id: params.id }, include: { mediaItem: true } });
  if (!episode?.filePath) return new Response('Introuvable', { status: 404 });
  if (episode.mediaItem.matchStatus !== 'MATCHED' && session.role !== 'ADMIN') {
    return new Response('Introuvable', { status: 404 });
  }

  if (session.role !== 'ADMIN') {
    const now = new Date();
    const blocked = await db.upcomingRelease.findFirst({
      where: {
        AND: [
          { OR: [{ sourceEpisodeId: episode.id }, { mediaPath: episode.filePath }] },
          { OR: [{ status: 'PENDING' }, { status: 'HIDDEN' }, { status: 'UPCOMING', availableAt: { gt: now } }] },
        ],
      },
    });
    if (blocked) return new Response('Introuvable', { status: 404 });
  }

  const chapters = await probeChapters(episode.filePath);
  return NextResponse.json({ chapters }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
}
