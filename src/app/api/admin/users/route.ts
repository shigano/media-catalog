import { NextRequest, NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

import { env } from '@/lib/config';
import { requireAdminSession } from '@/lib/session';

export async function GET(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();

  const connection = await mysql.createConnection(
    env.accountPortalDatabaseUrl(),
  );

  try {
    const [users] = await connection.execute(
      `
      SELECT
        u.id,
        u.email,
        u.role,
        u.emailVerified,

        s.id AS subscriptionId,
        s.status,
        s.planId,
        s.adminPlanId,
        s.adminPlanExpiresAt,

        p.name AS planName,
        ap.name AS adminPlanName

      FROM User u

      LEFT JOIN Subscription s
        ON s.id = (
          SELECT s2.id
          FROM Subscription s2
          WHERE s2.userId = u.id
          ORDER BY
            CASE
              WHEN s2.status = 'ACTIVE' THEN 0
              WHEN s2.status = 'SUSPENDED' THEN 1
              ELSE 2
            END,
            s2.createdAt DESC
          LIMIT 1
        )

      LEFT JOIN Plan p
        ON p.id = s.planId

      LEFT JOIN Plan ap
        ON ap.id = s.adminPlanId

      WHERE (? = '' OR u.email LIKE CONCAT('%', ?, '%'))

      ORDER BY u.createdAt DESC
      LIMIT 200
      `,
      [q, q],
    );

    const [plans] = await connection.execute(
      `
      SELECT
        id,
        name,
        priceCents,
        maxConcurrentStreams,
        hasAds
      FROM Plan
      WHERE active = 1
      ORDER BY priceCents ASC, name ASC
      `,
    );

    return NextResponse.json({
      users,
      plans,
    });
  } finally {
    await connection.end();
  }
}

export async function PATCH(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const body = await req.json();

  const userId = String(body.userId ?? '');
  const planId = String(body.planId ?? '');

  if (!userId || !planId) {
    return NextResponse.json(
      { error: 'Utilisateur et offre requis.' },
      { status: 400 },
    );
  }

  let expiresAt: Date | null = null;

  if (body.expiresAt) {
    expiresAt = new Date(body.expiresAt);

    if (Number.isNaN(expiresAt.getTime())) {
      return NextResponse.json(
        { error: "Date d'expiration invalide." },
        { status: 400 },
      );
    }

    if (expiresAt <= new Date()) {
      return NextResponse.json(
        { error: "La date d'expiration doit être dans le futur." },
        { status: 400 },
      );
    }
  }

  const connection = await mysql.createConnection(
    env.accountPortalDatabaseUrl(),
  );

  try {
    const [planRows] = await connection.execute(
      `
      SELECT id
      FROM Plan
      WHERE id = ?
        AND active = 1
      LIMIT 1
      `,
      [planId],
    );

    if (!(planRows as any[])[0]) {
      return NextResponse.json(
        { error: 'Offre introuvable ou inactive.' },
        { status: 404 },
      );
    }

    const [subscriptionRows] = await connection.execute(
      `
      SELECT id
      FROM Subscription
      WHERE userId = ?
        AND status IN ('ACTIVE', 'SUSPENDED')
      ORDER BY
        CASE
          WHEN status = 'ACTIVE' THEN 0
          ELSE 1
        END,
        createdAt DESC
      LIMIT 1
      `,
      [userId],
    );

    const subscription = (subscriptionRows as any[])[0];

    if (!subscription) {
      return NextResponse.json(
        {
          error:
            "Cet utilisateur n'a aucun abonnement actif ou suspendu.",
        },
        { status: 400 },
      );
    }

    await connection.execute(
      `
      UPDATE Subscription
      SET
        adminPlanId = ?,
        adminPlanExpiresAt = ?
      WHERE id = ?
      `,
      [planId, expiresAt, subscription.id],
    );

    return NextResponse.json({ ok: true });
  } finally {
    await connection.end();
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireAdminSession(req);
  if (session instanceof NextResponse) return session;

  const body = await req.json();
  const userId = String(body.userId ?? '');

  if (!userId) {
    return NextResponse.json(
      { error: 'Utilisateur requis.' },
      { status: 400 },
    );
  }

  const connection = await mysql.createConnection(
    env.accountPortalDatabaseUrl(),
  );

  try {
    const [subscriptionRows] = await connection.execute(
      `
      SELECT id
      FROM Subscription
      WHERE userId = ?
        AND status IN ('ACTIVE', 'SUSPENDED')
      ORDER BY
        CASE
          WHEN status = 'ACTIVE' THEN 0
          ELSE 1
        END,
        createdAt DESC
      LIMIT 1
      `,
      [userId],
    );

    const subscription = (subscriptionRows as any[])[0];

    if (!subscription) {
      return NextResponse.json(
        { error: 'Aucun abonnement concerné.' },
        { status: 404 },
      );
    }

    await connection.execute(
      `
      UPDATE Subscription
      SET
        adminPlanId = NULL,
        adminPlanExpiresAt = NULL
      WHERE id = ?
      `,
      [subscription.id],
    );

    return NextResponse.json({ ok: true });
  } finally {
    await connection.end();
  }
}
