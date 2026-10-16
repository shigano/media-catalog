import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';

export async function GET(req: Request) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const url = new URL(req.url);
  const status = url.searchParams.get('status') || 'OPEN';
  const reviews = await db.scanReview.findMany({
    where: status === 'ALL' ? {} : { status },
    include: {
      mediaItem: {
        select: {
          id: true,
          title: true,
          type: true,
          tmdbId: true,
          matchStatus: true,
          folderPath: true,
          filePath: true,
        },
      },
    },
    orderBy: [{ updatedAt: 'desc' }],
  });

  return NextResponse.json({ count: reviews.length, reviews });
}
