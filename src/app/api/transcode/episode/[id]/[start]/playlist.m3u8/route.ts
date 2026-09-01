import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';
import { servePlaylist } from '@/lib/transcodeRoutes';
import { enforceStreamLimit } from '@/lib/streamSessionLimit';

export async function GET(
  req: Request,
  { params }: { params: { id: string; start: string } },
) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const limitResponse = await enforceStreamLimit(req, session);
  if (limitResponse) return limitResponse;

  const episode = await db.episode.findUnique({ where: { id: params.id }, include: { mediaItem: true } });
  if (!episode?.filePath) return new Response('Introuvable', { status: 404 });
  if (episode.mediaItem.matchStatus !== 'MATCHED' && session.role !== 'ADMIN') {
    return new Response('Introuvable', { status: 404 });
  }

  const startSeconds = Math.max(0, Math.floor(Number(params.start) || 0));
  const sessionKey = `episode-${episode.id}-${startSeconds}`;
  return servePlaylist(sessionKey, episode.filePath, startSeconds);
}
