import { ScanControl } from './scan-control';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="mb-2 text-3xl font-semibold text-ink">Dream-Films</h1>
      <p className="mb-8 text-sm text-inkMuted">
        Détection et catalogage automatique de ta bibliothèque, sur le
        modèle de Jellyfin : scan des dossiers, reconnaissance des
        films/séries, correspondance TMDB.
      </p>
      <ScanControl />
    </main>
  );
}
