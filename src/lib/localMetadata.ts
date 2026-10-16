import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type ProviderHints = {
  tmdbId: number | null;
  imdbId: string | null;
  tvdbId: number | null;
  title: string | null;
  originalTitle: string | null;
  year: number | null;
  nfoPath: string | null;
};

function decodeXml(v: string): string {
  return v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? decodeXml(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) : null;
}
function uniqueId(xml: string, type: string): string | null {
  const re = new RegExp(`<uniqueid[^>]*type=["']${type}["'][^>]*>([^<]+)<\\/uniqueid>`, 'i');
  const m = xml.match(re);
  return m ? decodeXml(m[1]) : null;
}
function numberOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v.replace(/\D+/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}


async function readNfoCandidates(candidates: string[]): Promise<ProviderHints> {
  for (const nfoPath of candidates) {
    try {
      await stat(nfoPath);
      const xml = await readFile(nfoPath, 'utf8');
      const tmdb = uniqueId(xml, 'tmdb') ?? tag(xml, 'tmdbid');
      const imdb = uniqueId(xml, 'imdb') ?? tag(xml, 'imdbid');
      const tvdb = uniqueId(xml, 'tvdb') ?? tag(xml, 'tvdbid');
      const yearText = tag(xml, 'year') ?? tag(xml, 'premiered')?.slice(0, 4) ?? null;
      return {
        tmdbId: numberOrNull(tmdb),
        imdbId: imdb && /^tt\d+$/i.test(imdb.trim()) ? imdb.trim() : null,
        tvdbId: numberOrNull(tvdb),
        title: tag(xml, 'title'),
        originalTitle: tag(xml, 'originaltitle'),
        year: numberOrNull(yearText),
        nfoPath,
      };
    } catch { /* fichier absent / illisible */ }
  }
  return { tmdbId: null, imdbId: null, tvdbId: null, title: null, originalTitle: null, year: null, nfoPath: null };
}

/**
 * Identité d'une SERIE : uniquement tvshow.nfo.
 * Un NFO d'épisode (S01E01.nfo) ne doit JAMAIS renommer la série ni lui
 * injecter les IDs d'un épisode. C'était la cause du faux titre Bleach.
 */
export async function readSeriesNfo(folderPath: string): Promise<ProviderHints> {
  return readNfoCandidates([path.join(folderPath, 'tvshow.nfo')]);
}

/** Identité d'un FILM : movie.nfo puis sidecar portant le nom du fichier. */
export async function readMovieNfo(folderPath: string, mediaFilePath: string): Promise<ProviderHints> {
  return readNfoCandidates([
    path.join(folderPath, 'movie.nfo'),
    mediaFilePath.replace(/\.[^.]+$/, '.nfo'),
  ]);
}

/** Compatibilité interne : lecture générique historique. Préférer readSeriesNfo/readMovieNfo. */
export async function readLocalNfo(folderPath: string, mediaFilePath?: string): Promise<ProviderHints> {
  return mediaFilePath ? readMovieNfo(folderPath, mediaFilePath) : readSeriesNfo(folderPath);
}

/** AniList est public : on l'utilise seulement comme source d'alias pour les bibliothèques Anime. */
export async function getAniListAliases(title: string): Promise<string[]> {
  try {
    const query = `query ($search: String) { Media(search: $search, type: ANIME) { title { romaji english native } synonyms } }`;
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { search: title } }),
    });
    if (!response.ok) return [];
    const d = await response.json();
    const media = d?.data?.Media;
    const values = [media?.title?.romaji, media?.title?.english, media?.title?.native, ...(media?.synonyms ?? [])]
      .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 1);

    // V3.6 : AniList n'est qu'un fournisseur d'alias, jamais une autorité
    // capable de réduire "Bleach: Thousand-Year Blood War" à "Bleach".
    // On garde uniquement les alias qui conservent une part significative
    // des mots distinctifs du titre physique demandé.
    const norm = (v: string) => v
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
    const queryTokens = new Set(norm(title).split(' ').filter((t) => t.length > 2));
    const filtered = values.filter((candidate) => {
      if (queryTokens.size <= 1) return true;
      const candidateTokens = new Set(norm(candidate).split(' ').filter((t) => t.length > 2));
      const overlap = [...queryTokens].filter((t) => candidateTokens.has(t)).length;
      return overlap / queryTokens.size >= 0.5;
    });
    return [...new Set(filtered)].slice(0, 12);
  } catch {
    return [];
  }
}

export function extractExternalIdsFromName(raw: string): { imdbId: string | null; tvdbId: number | null } {
  const imdb = raw.match(/(?:imdb(?:id)?\s*[-:=]?\s*)(tt\d+)/i)?.[1] ?? null;
  const tvdbRaw = raw.match(/(?:tvdb(?:id)?\s*[-:=]?\s*)(\d+)/i)?.[1] ?? null;
  return { imdbId: imdb, tvdbId: tvdbRaw ? Number(tvdbRaw) : null };
}
