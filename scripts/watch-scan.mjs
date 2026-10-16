// Surveillance fiable des NAS par empreinte de chemins, toutes les 60 s.
// Contrairement à fs.watch/inotify, ce mode continue à fonctionner avec
// beaucoup de montages réseau qui ne remontent pas correctement les
// événements du système de fichiers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const SECRET = process.env.AUTO_SCAN_SECRET;
const INTERVAL_MS = Math.max(30_000, Number(process.env.AUTO_SCAN_INTERVAL_MS ?? 60_000));
const BASE_URL = (process.env.MEDIA_CATALOG_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');

if (!SECRET) {
  console.error('[watch-scan] AUTO_SCAN_SECRET manquant dans .env');
  process.exit(1);
}

let running = false;
async function check() {
  if (running) return;
  running = true;
  try {
    const res = await fetch(`${BASE_URL}/api/scan/auto`, {
      method: 'POST',
      headers: { 'x-auto-scan-secret': SECRET },
    });
    const data = await res.json();
    if (!data.skipped && data.ok) {
      const libs = Array.isArray(data.librariesScanned) ? data.librariesScanned.join(', ') : '';
      console.log(`[watch-scan] modification détectée, scan ${data.scanLogId}${libs ? ` (${libs})` : ''}`);
    } else if (!data.ok && !data.skipped) {
      console.error('[watch-scan] réponse inattendue', data);
    }
  } catch (err) {
    console.error('[watch-scan] erreur', err?.message ?? err);
  } finally {
    running = false;
  }
}

await check();
setInterval(check, INTERVAL_MS);
console.log(`[watch-scan] surveillance active toutes les ${Math.round(INTERVAL_MS / 1000)} s`);
