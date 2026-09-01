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

  const item = await db.mediaItem.findUnique({ where: { id: params.id } });
  if (!item?.filePath) return new Response('Introuvable', { status: 404 });
  if (item.matchStatus !== 'MATCHED' && session.role !== 'ADMIN') {
    return new Response('Introuvable', { status: 404 });
  }

  const startSeconds = Math.max(0, Math.floor(Number(params.start) || 0));
  const sessionKey = `movie-${item.id}-${startSeconds}`;
  return servePlaylist(sessionKey, item.filePath, startSeconds);
}
