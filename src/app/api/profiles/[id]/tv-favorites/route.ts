import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/lib/db';
import { requireActiveSession } from '@/lib/session';

const FavoriteBody = z.object({ channelId: z.string().min(1).max(128) });

async function authorize(req: NextRequest, profileId: string) {
  const session = await requireActiveSession(req);
  if (session instanceof NextResponse) return { error: session };
  const profile = await db.profile.findFirst({
    where: { id: profileId, userId: session.userId },
    select: { id: true },
  });
  if (!profile) return { error: NextResponse.json({ error: 'Profil introuvable' }, { status: 404 }) };
  return { profile };
}

/** Liste des identifiants de chaînes favorites du profil. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize(req, params.id);
  if (auth.error) return auth.error;
  const favorites = await db.tvChannelFavorite.findMany({
    where: { profileId: params.id, channel: { isActive: true } },
    orderBy: { createdAt: 'asc' },
    select: { channelId: true },
  });
  return NextResponse.json({ channelIds: favorites.map((f) => f.channelId) });
}

/** Ajout idempotent : évite les doublons lors d'une migration Windows. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize(req, params.id);
  if (auth.error) return auth.error;
  const parsed = FavoriteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Chaîne invalide' }, { status: 400 });
  const channel = await db.tvChannel.findFirst({
    where: { id: parsed.data.channelId, isActive: true },
    select: { id: true },
  });
  if (!channel) return NextResponse.json({ error: 'Chaîne introuvable' }, { status: 404 });
  await db.tvChannelFavorite.upsert({
    where: { profileId_channelId: { profileId: params.id, channelId: channel.id } },
    update: {},
    create: { profileId: params.id, channelId: channel.id },
  });
  return NextResponse.json({ ok: true });
}

/** Retrait d'un favori du profil, sans toucher aux autres profils. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorize(req, params.id);
  if (auth.error) return auth.error;
  const channelId = req.nextUrl.searchParams.get('channelId');
  if (!channelId || channelId.length > 128) {
    return NextResponse.json({ error: 'Chaîne invalide' }, { status: 400 });
  }
  await db.tvChannelFavorite.deleteMany({ where: { profileId: params.id, channelId } });
  return NextResponse.json({ ok: true });
}
