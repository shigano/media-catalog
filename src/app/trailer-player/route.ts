import { NextResponse } from 'next/server';

// Page publique minimale : le navigateur transmet l'origine HTTPS reelle
// a YouTube pour son lecteur integre (erreur 153 sans Referer).
export function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('v') ?? '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return new NextResponse('Invalid video', { status: 400 });
  }
  const html = `<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>Bande-annonce Dream-Films</title>
<style>html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}
iframe{border:0;width:100%;height:100%}</style></head><body>
<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0"
 referrerpolicy="strict-origin-when-cross-origin"
 allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
 allowfullscreen title="Bande-annonce"></iframe></body></html>`;
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
