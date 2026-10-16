import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';
import { probePlaybackTracks } from '@/lib/trackProbe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;
  const item = await db.mediaItem.findUnique({ where: { id: params.id } });
  if (!item?.filePath) return new Response('Introuvable', { status: 404 });
  if (item.matchStatus !== 'MATCHED' && session.role !== 'ADMIN') return new Response('Introuvable', { status: 404 });
  const tracks = await probePlaybackTracks(item.filePath);
  return NextResponse.json({ tracks }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
}
