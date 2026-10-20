import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { mkdir, rm, stat } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';

import { probeFile } from './ffprobe';

type Session = {
  process: ChildProcessWithoutNullStreams;
  outputDir: string;
  lastAccessed: number;
};

const sessions = new Map<string, Session>();
const execFileAsync = promisify(execFile);

/** Select a French audio stream by its audio-stream ordinal (not its global stream index). */
export async function frenchAudioOrdinal(filePath: string): Promise<number | null> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream_tags=language',
    '-of', 'json', filePath,
  ]);
  const data = JSON.parse(stdout) as { streams?: Array<{ tags?: { language?: string } }> };
  const index = (data.streams ?? []).findIndex((stream) =>
    ['fr', 'fra', 'fre'].includes((stream.tags?.language ?? '').toLowerCase()),
  );
  return index >= 0 ? index : null;
}
const BASE_TMP_DIR = path.join(os.tmpdir(), 'media-catalog-transcode');
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes sans activité

// Nettoyage périodique des sessions abandonnées (onglet fermé, lecture
// arrêtée sans revenir...) — évite d'accumuler des process ffmpeg et des
// fichiers temporaires indéfiniment.
setInterval(async () => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.lastAccessed > SESSION_TIMEOUT_MS) {
      session.process.kill();
      sessions.delete(key);
      await rm(session.outputDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}, 60 * 1000);

// Important : sans ça, un redémarrage (pm2 restart, nouveau déploiement)
// laisse les process ffmpeg en cours orphelins en arrière-plan — invisibles
// pour le nouveau process Node, ils continuent d'écrire dans leur dossier
// de sortie jusqu'à ce que quelque chose (comme un `rm -rf` de nettoyage)
// le fasse planter en pleine écriture.
function killAllSessions() {
  for (const session of sessions.values()) {
    session.process.kill('SIGKILL');
  }
}
process.on('SIGTERM', killAllSessions);
process.on('SIGINT', killAllSessions);

/**
 * Démarre (ou réutilise) une session de transcodage HLS pour ce fichier,
 * à partir de `startSeconds` (0 par défaut), et renvoie le dossier où
 * sont écrits la playlist et les segments. Un saut dans la barre de
 * progression déclenche une NOUVELLE session (clé différente incluant la
 * position), donc un nouveau process ffmpeg démarré directement à cet
 * endroit — plutôt que d'attendre que le transcodage progressif y arrive.
 */
export async function getOrCreateHlsSession(
  sessionKey: string,
  filePath: string,
  startSeconds = 0,
  audioLang?: string,
  preferVideoCopy = false,
): Promise<string> {
  const existing = sessions.get(sessionKey);
  if (existing) {
    existing.lastAccessed = Date.now();
    return existing.outputDir;
  }

  const outputDir = path.join(BASE_TMP_DIR, sessionKey);
  await mkdir(outputDir, { recursive: true });

  const probe = await probeFile(filePath).catch(() => ({ videoCodec: null, audioCodec: null }));
  // On réencode TOUJOURS la vidéo, même si elle est déjà en H.264: une
  // simple copie directe depuis un .mkv vers du HLS produit souvent un
  // flux que les lecteurs classiques (VLC...) acceptent mais que les
  // navigateurs (MediaSource Extensions) refusent d'intégrer
  // correctement (bufferAppendError). Moins rapide, mais fiable.
  // "ultrafast" + réduction à 720p max : sur un VPS au CPU limité (et
  // partagé avec d'autres services), un encodage 1080p "veryfast" peut
  // être plus lent que la lecture elle-même (constaté : speed=0.436x,
  // donc deux fois trop lent), ce qui cause des blocages répétés. On
  // sacrifie de la qualité d'image pour rester fluide.
  const videoArgs = preferVideoCopy && probe.videoCodec === 'h264'
    ? ['-c:v', 'copy']
    : [
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-vf', 'scale=-2:min(720\\,ih)',
  ];
  // Explicit French selection is opt-in; default playback retains its original mapping.
  const frenchOrdinal = audioLang === 'fr'
    ? await frenchAudioOrdinal(filePath).catch(() => null)
    : null;
  console.info(`[HLS] ${sessionKey} video=${probe.videoCodec} mode=${preferVideoCopy && probe.videoCodec === 'h264' ? 'copy' : 'transcode'}`);
  const audioArgs =
    frenchOrdinal === null && (probe.audioCodec === 'aac' || probe.audioCodec === 'mp3')
      ? ['-c:a', 'copy']
      : // -ac 2 : force le mixage en stéréo. Le 5.1 encodé en AAC utilise
        // souvent une configuration de canaux (PCE) mal supportée par les
        // décodeurs audio des navigateurs, même quand ffmpeg s'en sort
        // très bien lui-même — d'où des échecs d'intégration côté lecteur
        // qui n'ont rien à voir avec la vidéo.
        ['-c:a', 'aac', '-ac', '2', '-b:a', '192k'];

  const seekArgs = startSeconds > 0 ? ['-ss', String(startSeconds)] : [];

  const ffmpegProcess = spawn('ffmpeg', [
    ...seekArgs, // AVANT -i : seek rapide (précision à la keyframe près)
    '-i',
    filePath,
    ...videoArgs,
    ...(frenchOrdinal !== null ? ['-map', '0:v:0', '-map', `0:a:${frenchOrdinal}`] : []),
    ...audioArgs,
    '-f',
    'hls',
    '-hls_time',
    '6',
    '-hls_list_size',
    '0',
    // Important : "vod" dit au lecteur "voici la liste complète et
    // définitive", ce qui pousse ffmpeg à n'écrire la playlist qu'une
    // fois TOUT le fichier transcodé — l'inverse de ce qu'on veut. "event"
    // est le type prévu pour un enregistrement qui grandit
    // progressivement à partir d'un début fixe (contrairement à un vrai
    // direct) : la playlist est mise à jour au fil de l'eau, avec un vrai
    // point de départ et une vraie durée dès les premiers segments.
    '-hls_playlist_type',
    'event',
    '-hls_segment_filename',
    path.join(outputDir, 'segment%03d.ts'),
    path.join(outputDir, 'playlist.m3u8'),
  ]);

  // ffmpeg écrit sa progression sur stderr en continu — on la garde en
  // mémoire (juste les dernières lignes) pour pouvoir la loguer si le
  // process échoue, plutôt que de la jeter silencieusement comme avant.
  let recentStderr = '';
  ffmpegProcess.stderr.on('data', (chunk) => {
    recentStderr = (recentStderr + chunk.toString()).slice(-2000);
  });
  ffmpegProcess.on('error', (err) => {
    console.error(`Échec de démarrage de ffmpeg pour ${sessionKey} :`, err);
  });
  ffmpegProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`ffmpeg a quitté avec le code ${code} pour ${sessionKey}. Fin des logs :\n${recentStderr}`);
    }
  });

  sessions.set(sessionKey, { process: ffmpegProcess, outputDir, lastAccessed: Date.now() });
  return outputDir;
}

/** Attend qu'un fichier existe (la playlist ou un segment pas encore écrit par ffmpeg). */
export async function waitForFile(filePath: string, maxWaitMs = 15000, intervalMs = 300): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      await stat(filePath);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return false;
}

export function touchSession(sessionKey: string) {
  const session = sessions.get(sessionKey);
  if (session) session.lastAccessed = Date.now();
}
