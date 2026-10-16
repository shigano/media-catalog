import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

/**
 * GET /api/admin/reports
 * Liste tous les signalements, du plus récent au plus ancien, avec de
 * quoi identifier le titre concerné et le profil qui l'a signalé.
 */
export async function GET(req: Request) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const reports = await db.report.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      mediaItem: { select: { id: true, title: true, matchedTitle: true, type: true } },
      profile: { select: { name: true } },
    },
  });

  return NextResponse.json({
    reports: reports.map((r) => ({
      id: r.id,
      mediaItemId: r.mediaItem.id,
      itemTitle: r.mediaItem.matchedTitle || r.mediaItem.title,
      itemType: r.mediaItem.type,
      profileName: r.profile.name,
      reason: r.reason,
      comment: r.comment,
      createdAt: r.createdAt,
    })),
  });
}
