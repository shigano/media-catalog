import { NextResponse } from 'next/server';

import { requireActiveSession } from '@/lib/session';
import { serveSegment } from '@/lib/transcodeRoutes';

export async function GET(
  req: Request,
  { params }: { params: { id: string; start: string; segment: string } },
) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const startSeconds = Math.max(0, Math.floor(Number(params.start) || 0));
  const audioLang = new URL(req.url).searchParams.get('audioLang') === 'fr' ? 'fr' : undefined;
  const preferVideoCopy = new URL(req.url).searchParams.get('videoMode') === 'copy';
  return serveSegment(`episode-${params.id}-${startSeconds}${audioLang ? '-fr' : ''}${preferVideoCopy ? '-vcopy' : ''}`, params.segment);
}
