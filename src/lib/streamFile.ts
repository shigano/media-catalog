import { createReadStream, statSync } from 'fs';
import path from 'path';

import { NextRequest } from 'next/server';

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ts': 'video/mp2t',
};

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

/**
 * Diffuse un fichier vidéo directement (pas de transcodage — c'est la
 * Phase 2 suivante). Ne fonctionne bien que pour les fichiers déjà dans un
 * format lisible nativement par le navigateur (typiquement MP4 en
 * H.264/AAC). Les .avi anciens, les pistes audio AC3/DTS ou certains codecs
 * dans les .mkv ne se liront pas correctement tant que le transcodage
 * n'est pas en place.
 */
export function streamFile(filePath: string, req: NextRequest): Response {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return new Response('Fichier introuvable sur le disque', { status: 404 });
  }

  const fileSize = stat.size;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const range = req.headers.get('range');

  if (!range) {
    const stream = createReadStream(filePath);
    return new Response(nodeStreamToWeb(stream), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const match = range.match(/bytes=(\d*)-(\d*)/);
  const start = match?.[1] ? parseInt(match[1], 10) : 0;
  const end = match?.[2] ? parseInt(match[2], 10) : fileSize - 1;
  const chunkSize = end - start + 1;

  const stream = createReadStream(filePath, { start, end });
  return new Response(nodeStreamToWeb(stream), {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(chunkSize),
    },
  });
}
