import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

/**
 * Initialise le SDK Firebase Admin (côté serveur — distinct du
 * google-services.json utilisé par l'appli cliente) à partir de la clé
 * de compte de service, stockée en une seule variable d'environnement
 * (le JSON complet, sur une ligne) plutôt qu'un fichier séparé à gérer
 * sur le VPS — plus simple à déployer et à ne jamais committer par
 * erreur.
 */
function getFirebaseApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON manquant dans .env');
  }
  const serviceAccount = JSON.parse(raw);
  return initializeApp({ credential: cert(serviceAccount) });
}

export function getFirebaseMessaging() {
  return getMessaging(getFirebaseApp());
}
