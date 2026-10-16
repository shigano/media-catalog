'use client';

import { useEffect, useState } from 'react';

type ScanLog = {
  id: string;
  status: string;
  filesScanned: number;
  itemsMatched: number;
  itemsUnmatched: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
} | null;

export function ScanControl() {
  const [scanLog, setScanLog] = useState<ScanLog>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    const res = await fetch('/api/scan');
    const data = await res.json();
    setScanLog(data.scanLog);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (scanLog?.status !== 'running') return;
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, [scanLog?.status]);

  async function startScan() {
    setLoading(true);
    const res = await fetch('/api/scan', { method: 'POST' });
    setLoading(false);
    if (res.ok) refresh();
  }

  async function rematchPending() {
    setLoading(true);
    const res = await fetch('/api/rematch-pending', { method: 'POST' });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      refresh();
    }
  }

  const running = scanLog?.status === 'running';

  return (
    <div className="rounded-ticket border border-white/10 bg-surface p-6">
      <div className="flex flex-wrap gap-3">
        <button
          onClick={startScan}
          disabled={loading || running}
          className="rounded-ticket bg-accent px-5 py-2.5 text-sm font-semibold text-background transition hover:bg-accentMuted disabled:opacity-60"
        >
          {running ? 'Scan en cours…' : 'Lancer un scan'}
        </button>
        <button
          onClick={rematchPending}
          disabled={loading || running}
          className="rounded-ticket border border-white/15 px-5 py-2.5 text-sm text-ink transition hover:border-white/30 disabled:opacity-60"
        >
          Retenter les items non reconnus
        </button>
      </div>

      {scanLog && (
        <div className="mt-4 text-sm text-inkMuted">
          <p>
            Dernier scan :{' '}
            <span className="text-ink">
              {scanLog.status === 'running'
                ? 'en cours'
                : scanLog.status === 'error'
                  ? 'erreur'
                  : 'terminé'}
            </span>
          </p>
          <p>Fichiers analysés : {scanLog.filesScanned}</p>
          <p>Reconnus automatiquement : {scanLog.itemsMatched}</p>
          <p>À vérifier manuellement : {scanLog.itemsUnmatched}</p>
          {scanLog.errorMessage && (
            <p className="mt-2 text-danger">Erreur : {scanLog.errorMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}
