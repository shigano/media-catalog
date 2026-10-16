import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';
import { streamFile } from '@/lib/streamFile';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;


  const item = await db.mediaItem.findUnique({ where: { id: params.id } });
  if (!item?.filePath) return new Response('Introuvable', { status: 404 });
  // Un client normal ne doit jamais pouvoir lire un titre pas encore
  // reconnu — masqué de la grille, mais ça ne protège rien si l'id est
  // devinable/partagé sans ce contrôle côté lecture elle-même.
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
  return streamFile(item.filePath, req);
}
