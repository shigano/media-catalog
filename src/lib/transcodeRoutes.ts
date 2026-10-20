import { createReadStream } from 'fs';
import { readFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { getOrCreateHlsSession, touchSession, waitForFile } from './transcodeSessions';

function nodeStreamToWeb(nodeStream: NodeJS.ReadableStream): ReadableStream {
  return new ReadableStream({
    start(controller) {
      nodeStream.on('data', (chunk) => controller.enqueue(chunk));
      nodeStream.on('end', () => controller.close());
      nodeStream.on('error', (err) => controller.error(err));
    },
    cancel() {
      (nodeStream as unknown as { destroy?: () => void }).destroy?.();
    },
  });
}

export async function servePlaylist(
  sessionKey: string,
  filePath: string,
  startSeconds = 0,
  audioLang?: string,
  preferVideoCopy = false,
): Promise<Response> {
  let outputDir: string;
  try {
    outputDir = await getOrCreateHlsSession(sessionKey, filePath, startSeconds, audioLang, preferVideoCopy);
  } catch (error) {
    if (error instanceof Error && error.message === 'FRENCH_AUDIO_NOT_FOUND') {
      return new Response('Piste audio française introuvable dans le fichier source', { status: 422 });
    }
    console.error('[HLS] Failed to initialize transcode session', error);
    return new Response('Impossible de démarrer le transcodage', { status: 500 });
  }
  const playlistPath = path.join(outputDir, 'playlist.m3u8');

  const ready = await waitForFile(playlistPath, 30000);
  if (!ready) {
    return new Response(
      "Le transcodage n'a pas pu démarrer à temps (ffmpeg est-il installé sur le serveur ?)",
      { status: 504 },
    );
  }

  let content = await readFile(playlistPath, 'utf-8');
  // Relative HLS segment URLs do not inherit the playlist query string.
  const segmentQuery = new URLSearchParams();
  if (audioLang === 'fr') segmentQuery.set('audioLang', 'fr');
  if (preferVideoCopy) segmentQuery.set('videoMode', 'copy');
  if (segmentQuery.toString()) {
    content = content.replace(/^(segment\d+\.ts)$/gm, `$1?${segmentQuery.toString()}`);
  }
  return new Response(content, {
    headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
  });
}

export async function serveSegment(sessionKey: string, segmentName: string): Promise<Response> {
  touchSession(sessionKey);
  const outputDir = path.join(os.tmpdir(), 'media-catalog-transcode', sessionKey);
  const segmentPath = path.join(outputDir, segmentName);

  // Un segment peut être demandé juste avant que ffmpeg ait fini de
  // l'écrire — on patiente un peu plutôt que de renvoyer une erreur.
  const ready = await waitForFile(segmentPath, 10000);
  if (!ready) {
    return new Response('Segment introuvable', { status: 404 });
  }

  const stream = createReadStream(segmentPath);
  return new Response(nodeStreamToWeb(stream), {
    headers: { 'Content-Type': 'video/mp2t' },
  });
}
