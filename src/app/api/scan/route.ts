import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { startFullScan } from '@/lib/scanEngine';
import { requireAdminSession } from '@/lib/session';

export async function POST(req: Request) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const result = await startFullScan();
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const latest = await db.scanLog.findFirst({ orderBy: { startedAt: 'desc' } });
  return NextResponse.json({ scanLog: latest });
}
