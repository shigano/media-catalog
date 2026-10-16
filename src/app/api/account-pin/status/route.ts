import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

/** GET /api/account-pin/status — le PIN existe-t-il déjà pour ce compte ? */
export async function GET(req: NextRequest) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return session;

  const pin = await db.accountPin.findUnique({ where: { userId: session.userId } });
  return NextResponse.json({ hasPin: !!pin });
}
