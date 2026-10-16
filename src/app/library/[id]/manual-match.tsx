'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Result = {
  tmdbId: number;
  title: string;
  year: string | null;
  posterUrl: string | null;
  overview: string;
};

export function ManualMatch({ itemId, itemTitle }: { itemId: string; itemTitle: string }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tmdbId, setTmdbId] = useState('');
  const [identifyPreview, setIdentifyPreview] = useState<Result | null>(null);
  const [identifying, setIdentifying] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch(`/api/items/${itemId}/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setResults(data.results ?? []);
    setLoading(false);
  }

  async function applyMatch(result: Result) {
    await fetch(`/api/items/${itemId}/rematch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tmdbId: result.tmdbId,
        title: result.title,
        posterUrl: result.posterUrl,
        overview: result.overview,
      }),
    });
    // Les saisons/épisodes affichés plus haut se rechargent avec les
    // nouvelles données TMDB dès que tmdbId change — pas d'action
    // supplémentaire nécessaire pour ça.
    router.refresh();
  }

  async function handleRefresh() {
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/items/${itemId}/refresh`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? 'Aucune correspondance trouvée sur TMDB.');
      } else {
        setMessage(`Actualisé : "${data.item.title}".`);
        router.refresh();
      }
    } catch {
      setMessage("Échec de l'actualisation.");
    }
    setRefreshing(false);
  }

  async function handleIdentifyLookup(e: React.FormEvent) {
    e.preventDefault();
    const id = parseInt(tmdbId, 10);
    if (!id) return;
    setIdentifying(true);
    setIdentifyPreview(null);
    try {
      const res = await fetch(`/api/items/${itemId}/identify?tmdbId=${id}`);
      const data = await res.json();
      if (res.ok) setIdentifyPreview(data.result);
      else setMessage(data.error ?? 'Identifiant introuvable.');
    } catch {
      setMessage("Échec de la recherche par identifiant.");
    }
    setIdentifying(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-ticket border border-white/10 bg-surface p-4">
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="rounded-ticket bg-accent px-4 py-2 text-sm font-semibold text-background"
        >
          {refreshing ? 'Actualisation…' : 'Actualiser les métadonnées'}
        </button>
        <p className="text-xs text-inkMuted">
          Relance automatiquement la recherche TMDB pour &quot;{itemTitle}&quot; — récupère une
          affiche manquante, un synopsis mis à jour, et pour une série, les bonnes données de
          saisons/épisodes ci-dessus.
        </p>
      </div>

      <div className="rounded-ticket border border-white/10 bg-surface p-6">
        <h2 className="mb-3 text-lg text-ink">Identifier par identifiant TMDB</h2>
        <form onSubmit={handleIdentifyLookup} className="mb-4 flex gap-2">
          <input
            type="number"
            value={tmdbId}
            onChange={(e) => setTmdbId(e.target.value)}
            placeholder="ex: 1399"
            className="flex-1 rounded-ticket border border-white/15 bg-background px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
          />
          <button
            type="submit"
            disabled={identifying}
            className="rounded-ticket bg-accent px-4 py-2 text-sm font-semibold text-background"
          >
            {identifying ? '…' : 'Chercher'}
          </button>
        </form>
        {identifyPreview && (
          <div className="flex items-start gap-3">
            <div className="w-16 shrink-0 overflow-hidden rounded-ticket bg-surfaceRaised">
              {identifyPreview.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={identifyPreview.posterUrl} alt={identifyPreview.title} className="w-full" />
              ) : null}
            </div>
            <div className="flex-1">
              <p className="text-sm text-ink">
                {identifyPreview.title} {identifyPreview.year ? `(${identifyPreview.year})` : ''}
              </p>
              <p className="mb-2 line-clamp-3 text-xs text-inkMuted">{identifyPreview.overview}</p>
              <button
                onClick={() => applyMatch(identifyPreview)}
                className="rounded-ticket bg-accent px-3 py-1.5 text-xs font-semibold text-background"
              >
                Appliquer
              </button>
            </div>
          </div>
        )}
      </div>

      {message && <p className="text-xs text-accent">{message}</p>}

      <div className="rounded-ticket border border-white/10 bg-surface p-6">
        <h2 className="mb-3 text-lg text-ink">Corriger par recherche</h2>
        <form onSubmit={handleSearch} className="mb-4 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher le vrai titre…"
            className="flex-1 rounded-ticket border border-white/15 bg-background px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-ticket bg-accent px-4 py-2 text-sm font-semibold text-background"
          >
            {loading ? '…' : 'Chercher'}
          </button>
        </form>

        {results.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {results.map((r) => (
              <button
                key={r.tmdbId}
                onClick={() => applyMatch(r)}
                className="text-left text-xs"
              >
                <div className="mb-1 aspect-[2/3] overflow-hidden rounded-ticket bg-surfaceRaised">
                  {r.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.posterUrl} alt={r.title} className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <p className="truncate text-ink">{r.title}</p>
                {r.year && <p className="text-inkMuted">{r.year}</p>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
