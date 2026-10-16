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
): Promise<Response> {
  const outputDir = await getOrCreateHlsSession(sessionKey, filePath, startSeconds);
  const playlistPath = path.join(outputDir, 'playlist.m3u8');

  const ready = await waitForFile(playlistPath, 30000);
  if (!ready) {
    return new Response(
      "Le transcodage n'a pas pu démarrer à temps (ffmpeg est-il installé sur le serveur ?)",
      { status: 504 },
    );
  }

  const content = await readFile(playlistPath, 'utf-8');
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
