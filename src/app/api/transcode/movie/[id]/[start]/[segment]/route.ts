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
  return serveSegment(`movie-${params.id}-${startSeconds}`, params.segment);
}
