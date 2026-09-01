import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { runScan } from '@/lib/scanEngine';
import { requireAdminSession } from '@/lib/session';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const running = await db.scanLog.findFirst({ where: { status: 'running' } });
  if (running) {
    return NextResponse.json({ error: 'Un scan est déjà en cours' }, { status: 409 });
  }

  const library = await db.library.findUnique({
    where: { id: params.id },
    include: { folders: true },
  });
  if (!library) {
    return NextResponse.json({ error: 'Médiathèque introuvable' }, { status: 404 });
  }

  const scanLog = await db.scanLog.create({ data: {} });
  void runScan(scanLog.id, [
    { id: library.id, name: library.name, folders: library.folders.map((f) => f.path) },
  ]);

  return NextResponse.json({ ok: true, scanLogId: scanLog.id });
}
