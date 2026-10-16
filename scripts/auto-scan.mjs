// Lancé par cron toutes les 5 minutes — voir la ligne crontab à ajouter.
// Appelle simplement la route HTTP dédiée (protégée par un secret
// partagé, pas de session admin nécessaire depuis un script serveur).
//
// Charge .env manuellement (pas de dépendance dotenv) : contrairement au
// serveur Next.js qui charge .env tout seul, un script node autonome
// lancé par cron n'a PAS accès aux variables de .env sans ce chargement
// explicite — c'est ce qui manquait jusqu'ici (AUTO_SCAN_SECRET restait
// toujours vide en pratique).
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

if (!SECRET) {
  console.error('[auto-scan] AUTO_SCAN_SECRET manquant dans .env');
  process.exit(1);
}

fetch('http://localhost:3001/api/scan/auto', {
  method: 'POST',
  headers: { 'x-auto-scan-secret': SECRET },
})
  .then((res) => res.json())
  .then((data) => {
    if (data.skipped) {
      console.log(`[auto-scan] ${data.reason}`);
    } else if (data.ok) {
      const libs = Array.isArray(data.librariesScanned) ? data.librariesScanned.join(', ') : '';
      console.log(`[auto-scan] Scan démarré : ${data.scanLogId}${libs ? ` (médiathèques : ${libs})` : ''}`);
    } else {
      console.error('[auto-scan] Réponse inattendue :', data);
    }
  })
  .catch((err) => {
    console.error('[auto-scan] Erreur :', err.message);
    process.exitCode = 1;
  });
