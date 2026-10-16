import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type PlaybackChapter = {
  title: string;
  startMs: number;
  endMs: number | null;
};

/**
 * Lit les chapitres embarqués dans le conteneur vidéo avec ffprobe.
 * Si le fichier n'en contient pas (ou si ffprobe échoue), on renvoie
 * simplement une liste vide : le lecteur reste parfaitement utilisable.
 */
export async function probeChapters(filePath: string): Promise<PlaybackChapter[]> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_chapters',
      filePath,
    ], { maxBuffer: 8 * 1024 * 1024 });

    const data = JSON.parse(stdout) as {
      chapters?: Array<{
        start_time?: string;
        end_time?: string;
        tags?: Record<string, string>;
      }>;
    };

    const chapters = (data.chapters ?? [])
      .map((chapter, index) => {
        const start = Number.parseFloat(chapter.start_time ?? '0');
        const end = Number.parseFloat(chapter.end_time ?? '');
        const rawTitle = chapter.tags?.title?.trim();
        return {
          title: rawTitle && rawTitle.length > 0 ? rawTitle : `Chapitre ${index + 1}`,
          startMs: Number.isFinite(start) ? Math.max(0, Math.round(start * 1000)) : 0,
          endMs: Number.isFinite(end) ? Math.max(0, Math.round(end * 1000)) : null,
        } satisfies PlaybackChapter;
      })
      .filter((chapter) => chapter.startMs >= 0)
      .sort((a, b) => a.startMs - b.startMs);

    return chapters;
  } catch (error) {
    console.warn('[CHAPTERS] ffprobe indisponible ou aucun chapitre exploitable', error);
    return [];
  }
}
