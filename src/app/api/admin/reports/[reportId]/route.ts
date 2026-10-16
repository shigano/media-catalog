import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

/**
 * DELETE /api/admin/reports/[reportId]
 * Supprime un signalement une fois traité — pas d'archive, un
 * signalement résolu n'a plus d'utilité à garder en base.
 */
export async function DELETE(req: Request, { params }: { params: { reportId: string } }) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  await db.report.delete({ where: { id: params.reportId } }).catch(() => null);

  return NextResponse.json({ ok: true });
}
