'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

type UserRow = {
  id: string;
  email: string;
  role: string;
  emailVerified: boolean | number | string | null;

  subscriptionId: string | null;
  status: string | null;

  planId: string | null;
  planName: string | null;

  adminPlanId: string | null;
  adminPlanName: string | null;
  adminPlanExpiresAt: string | null;
};

type Plan = {
  id: string;
  name: string;
  priceCents: number;
  maxConcurrentStreams: number;
  hasAds: boolean | number;
};

const STATUS: Record<string, string> = {
  ACTIVE: 'Actif',
  SUSPENDED: 'Suspendu',
  PENDING: 'En attente',
  CANCELLED: 'Résilié',
  EXPIRED: 'Expiré',
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q = '') => {
    setLoading(true);
    setError(null);

    const res = await fetch(
      `/api/admin/users?q=${encodeURIComponent(q)}`,
      { cache: 'no-store' },
    );

    if (res.status === 401 || res.status === 403) {
      window.location.href = '/login';
      return;
    }

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? 'Impossible de charger les utilisateurs.');
      setLoading(false);
      return;
    }

    setUsers(data.users ?? []);
    setPlans(data.plans ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitSearch(e: FormEvent) {
    e.preventDefault();
    await load(query);
  }

  async function applyPlan(
    userId: string,
    planId: string,
    expiresAt: string,
  ) {
    setMessage(null);
    setError(null);

    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        planId,
        expiresAt: expiresAt
          ? new Date(`${expiresAt}T23:59:59`).toISOString()
          : null,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Impossible d'appliquer l'offre.");
      return;
    }

    setMessage('Offre manuelle appliquée.');
    await load(query);
  }

  async function removePlan(userId: string) {
    if (
      !window.confirm(
        "Retirer l'offre manuelle et revenir à l'offre facturée ?",
      )
    ) {
      return;
    }

    setMessage(null);
    setError(null);

    const res = await fetch('/api/admin/users', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Impossible de retirer l'offre.");
      return;
    }

    setMessage('Offre manuelle retirée.');
    await load(query);
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-ink">
            Utilisateurs
          </h1>

          <p className="mt-2 text-sm text-inkMuted">
            Gestion des abonnements et des offres manuelles.
          </p>
        </div>

        <a
          href="/"
          className="rounded-ticket border border-white/15 px-4 py-2 text-sm text-ink"
        >
          Retour au catalogue
        </a>
      </div>

      <form
        onSubmit={submitSearch}
        className="mb-6 flex max-w-xl gap-2"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une adresse email…"
          className="flex-1 rounded-ticket border border-white/15 bg-background px-3 py-2 text-ink outline-none focus-visible:border-accent"
        />

        <button
          type="submit"
          className="rounded-ticket bg-accent px-4 py-2 font-semibold text-background"
        >
          Rechercher
        </button>
      </form>

      {message && (
        <div className="mb-4 rounded-ticket border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-ink">
          {message}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-ticket border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-inkMuted">Chargement…</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-inkMuted">
            {users.length} utilisateur
            {users.length > 1 ? 's' : ''}
          </p>

          <div className="overflow-x-auto rounded-ticket border border-white/10 bg-surface">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-inkMuted">
                  <th className="px-4 py-3 font-normal">Email</th>
                  <th className="px-4 py-3 font-normal">Offre facturée</th>
                  <th className="px-4 py-3 font-normal">Statut</th>
                  <th className="px-4 py-3 font-normal">Offre manuelle</th>
                  <th className="px-4 py-3 font-normal">Modifier</th>
                </tr>
              </thead>

              <tbody>
                {users.map((user) => (
                  <UserLine
                    key={user.id}
                    user={user}
                    plans={plans}
                    onApply={applyPlan}
                    onRemove={removePlan}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}

function UserLine({
  user,
  plans,
  onApply,
  onRemove,
}: {
  user: UserRow;
  plans: Plan[];
  onApply: (
    userId: string,
    planId: string,
    expiresAt: string,
  ) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
}) {
  const manualActive =
    Boolean(user.adminPlanId) &&
    (!user.adminPlanExpiresAt ||
      new Date(user.adminPlanExpiresAt) > new Date());

  const defaultPlanId =
    (manualActive ? user.adminPlanId : user.planId) ??
    plans[0]?.id ??
    '';

  const [planId, setPlanId] = useState(defaultPlanId);

  const [expiresAt, setExpiresAt] = useState(
    manualActive && user.adminPlanExpiresAt
      ? user.adminPlanExpiresAt.slice(0, 10)
      : '',
  );

  const canModify =
    user.status === 'ACTIVE' ||
    user.status === 'SUSPENDED';

  return (
    <tr className="border-b border-white/5 last:border-0">
      <td className="whitespace-nowrap px-4 py-3 text-ink">
        <div>{user.email}</div>

        <div className="mt-1 text-[11px] text-inkMuted">
          {user.role}
        </div>
      </td>

      <td className="whitespace-nowrap px-4 py-3 text-inkMuted">
        {user.planName ?? '—'}
      </td>

      <td className="whitespace-nowrap px-4 py-3 text-inkMuted">
        {user.status
          ? STATUS[user.status] ?? user.status
          : 'Aucun'}
      </td>

      <td className="px-4 py-3">
        {manualActive ? (
          <div>
            <div className="font-medium text-accent">
              {user.adminPlanName ?? 'Offre manuelle'}
            </div>

            {user.adminPlanExpiresAt ? (
              <div className="mt-1 text-xs text-inkMuted">
                Jusqu'au{' '}
                {new Intl.DateTimeFormat('fr-FR').format(
                  new Date(user.adminPlanExpiresAt),
                )}
              </div>
            ) : (
              <div className="mt-1 text-xs text-inkMuted">
                Permanente
              </div>
            )}
          </div>
        ) : (
          <span className="text-inkMuted">—</span>
        )}
      </td>

      <td className="min-w-[330px] px-4 py-3">
        {canModify ? (
          <div className="space-y-2">
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="w-full rounded-ticket border border-white/15 bg-background px-2 py-2 text-xs text-ink"
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                  {' — '}
                  {plan.maxConcurrentStreams} écrans
                  {plan.hasAds ? ' — avec pub' : ''}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-ticket border border-white/15 bg-background px-2 py-2 text-xs text-ink"
            />

            <div className="flex gap-2">
              <button
                type="button"
                disabled={!planId}
                onClick={() =>
                  void onApply(user.id, planId, expiresAt)
                }
                className="rounded-ticket bg-accent px-3 py-2 text-xs font-semibold text-background disabled:opacity-50"
              >
                Appliquer
              </button>

              {manualActive && (
                <button
                  type="button"
                  onClick={() => void onRemove(user.id)}
                  className="rounded-ticket border border-white/15 px-3 py-2 text-xs text-ink"
                >
                  Retirer
                </button>
              )}
            </div>

            <p className="text-[11px] text-inkMuted">
              Date vide = permanent.
            </p>
          </div>
        ) : (
          <span className="text-xs text-inkMuted">
            Aucun abonnement actif ou suspendu
          </span>
        )}
      </td>
    </tr>
  );
}
