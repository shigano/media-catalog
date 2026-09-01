'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? 'Une erreur est survenue');
      return;
    }
    window.location.href = '/';
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-ticket border border-white/10 bg-surface p-8"
      >
        <h1 className="mb-2 text-2xl text-ink">Dream-Films</h1>
        <p className="mb-6 text-sm text-inkMuted">
          Espace d'administration — réservé au compte admin.
        </p>

        <label className="mb-1 block text-sm text-inkMuted">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded-ticket border border-white/15 bg-background px-3 py-2 text-ink outline-none focus-visible:border-accent"
        />

        <label className="mb-1 block text-sm text-inkMuted">Mot de passe</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-6 w-full rounded-ticket border border-white/15 bg-background px-3 py-2 text-ink outline-none focus-visible:border-accent"
        />

        {error && <p className="mb-4 text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-ticket bg-accent py-3 font-semibold text-background transition hover:bg-accentMuted disabled:opacity-60"
        >
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>

        <p className="mt-4 text-center text-xs text-inkMuted">
          Mêmes identifiants que le portail d'abonnement.
        </p>
      </form>
    </main>
  );
}
