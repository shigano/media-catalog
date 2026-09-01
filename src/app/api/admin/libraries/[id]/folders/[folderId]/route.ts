import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; folderId: string } },
) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  await db.libraryFolder.delete({ where: { id: params.folderId } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
