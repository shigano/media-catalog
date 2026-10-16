import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireAdminSession(req);
  if (s instanceof NextResponse) return s;
  const b = await req.json();
  const current = await db.upcomingRelease.findUnique({ where: { id: params.id } });
  if (!current) return NextResponse.json({ error: 'Introuvable' }, { status: 404 });

  const action = String(b.action || '');
  if (action === 'publish-now') {
    await db.upcomingRelease.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true, action });
  }
  if (action === 'hide') {
    const item = await db.upcomingRelease.update({ where: { id: params.id }, data: { status: 'HIDDEN', enabled: false } });
    return NextResponse.json({ item });
  }
  if (action === 'schedule') {
    if (!b.availableAt) return NextResponse.json({ error: 'Date requise' }, { status: 400 });
    const item = await db.upcomingRelease.update({
      where: { id: params.id },
      data: {
        status: 'UPCOMING',
        enabled: true,
        availableAt: new Date(b.availableAt),
        publishAt: b.publishAt ? new Date(b.publishAt) : null,
      },
    });
    return NextResponse.json({ item });
  }
  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireAdminSession(req);
  if (s instanceof NextResponse) return s;
  await db.upcomingRelease.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
