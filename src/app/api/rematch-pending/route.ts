import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireAdminSession } from '@/lib/session';
import { findBestTmdbMatch } from '@/lib/tmdbMatch';
import { withRetry } from '@/lib/retry';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRematch(scanLogId: string) {
  const pending = await db.mediaItem.findMany({
    where: { matchStatus: { not: 'MATCHED' } },
  });

  let matched = 0;
  let unmatched = 0;

  for (const item of pending) {
    try {
      const result = await withRetry(() => findBestTmdbMatch(item.title, item.year, item.type));
      const matchStatus = !result ? 'UNMATCHED' : result.confident ? 'MATCHED' : 'AMBIGUOUS';
      if (matchStatus === 'MATCHED') matched += 1;
      else unmatched += 1;

      await db.mediaItem.update({
        where: { id: item.id },
        data: {
          tmdbId: result?.tmdbId,
          matchedTitle: result?.title,
          posterUrl: result?.posterUrl,
          overview: result?.overview,
          matchStatus,
        },
      });
    } catch (e) {
      unmatched += 1;
      console.error(`Échec de re-correspondance pour "${item.title}" :`, e);
    }

    await db.scanLog.update({
      where: { id: scanLogId },
      data: { itemsMatched: matched, itemsUnmatched: unmatched },
    });
    await sleep(100);
  }

  await db.scanLog.update({
    where: { id: scanLogId },
    data: { status: 'done', filesScanned: pending.length, finishedAt: new Date() },
  });
  console.log(`Re-correspondance terminée : ${matched}/${pending.length} corrigés.`);
}

export async function POST(req: Request) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const running = await db.scanLog.findFirst({ where: { status: 'running' } });
  if (running) {
    return NextResponse.json({ error: 'Un scan ou une re-tentative est déjà en cours' }, { status: 409 });
  }

  const pendingCount = await db.mediaItem.count({ where: { matchStatus: { not: 'MATCHED' } } });
  const scanLog = await db.scanLog.create({ data: {} });
  void runRematch(scanLog.id);

  return NextResponse.json({ ok: true, pendingCount });
}
