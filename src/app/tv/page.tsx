'use client';

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';

type Channel = {
  id: string; name: string; number: number | null; category: string;
  sourceType: string; sourceUrl: string; logoUrl: string | null;
  epgId: string | null; rightsNote: string | null; isActive: boolean;
};
type ReviewCandidate = {
  id: string; name: string; height: number; qualitySource: string;
  categorySuggestion: string; rightsStatus: string; approvedForActivation: boolean;
};
type ReviewReport = { channels: ReviewCandidate[]; manualReview?: unknown[] };
type FormValues = {
  name: string; number: string; category: string; sourceType: string;
  sourceUrl: string; logoUrl: string; epgId: string; rightsNote: string;
};
const empty: FormValues = {
  name: '', number: '', category: 'Autres', sourceType: 'OFFICIAL',
  sourceUrl: '', logoUrl: '', epgId: '', rightsNote: '',
};
function fromChannel(c: Channel): FormValues {
  return { name: c.name, number: c.number?.toString() ?? '',
    category: c.category, sourceType: c.sourceType, sourceUrl: c.sourceUrl,
    logoUrl: c.logoUrl ?? '', epgId: c.epgId ?? '', rightsNote: c.rightsNote ?? '' };
}
function parseM3u(text: string): FormValues[] {
  const lines = text.replace(/\r/g, '').split('\n');
  if (!lines[0]?.trim().startsWith('#EXTM3U')) throw new Error('Playlist M3U invalide : en-tête #EXTM3U absent.');
  const entries: FormValues[] = [];
  let meta = '';
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) { meta = line; continue; }
    if (!line || line.startsWith('#')) continue;
    if (!meta) continue;
    const name = meta.substring(meta.lastIndexOf(',') + 1).trim();
    const attr = (key: string) => {
      const match = meta.match(new RegExp(key + '="([^"]*)"', 'i'));
      return match?.[1] ?? '';
    };
    const url = line;
    if (!url.startsWith('https://')) { meta = ''; continue; }
    entries.push({
      ...empty, name: name || attr('tvg-name') || 'Chaîne',
      category: attr('group-title') || 'Autres',
      logoUrl: attr('tvg-logo'), epgId: attr('tvg-id'),
      sourceType: /\.mpd(?:\?|$)/i.test(url) ? 'DASH' : 'HLS',
      sourceUrl: url,
    });
    meta = '';
    if (entries.length >= 300) break;
  }
  return entries;
}
export default function TvAdminPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [form, setForm] = useState<FormValues>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [imports, setImports] = useState<FormValues[]>([]);
  const [review, setReview] = useState<ReviewCandidate[]>([]);
  const [reviewFilter, setReviewFilter] = useState('manual');
  const [rightsNote, setRightsNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/tv/channels', { cache: 'no-store' });
    if (res.status === 401 || res.status === 403) { window.location.href = '/login'; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Chargement impossible');
    setChannels(data.channels || []);
  }, []);
  useEffect(() => { void load().catch(e => setError(String(e))); }, [load]);

  async function request(method: string, body?: object, suffix = '') {
    const res = await fetch('/api/admin/tv/channels' + suffix, {
      method, headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Opération impossible');
    return data;
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setMessage(''); setBusy(true);
    try {
      const payload = { ...form, number: form.number ? Number(form.number) : null };
      if (editing) await request('PATCH', { id: editing, ...payload });
      else await request('POST', payload);
      setMessage(editing ? 'Chaîne modifiée.' : 'Chaîne créée, désactivée par défaut.');
      setEditing(null); setForm(empty); await load();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function toggle(c: Channel) {
    setError(''); setBusy(true);
    try { await request('PATCH', { id: c.id, isActive: !c.isActive }); await load(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function remove(c: Channel) {
    if (!window.confirm('Supprimer définitivement ' + c.name + ' et ses programmes TV ?')) return;
    setError(''); setBusy(true);
    try { await request('DELETE', undefined, '?id=' + encodeURIComponent(c.id)); await load(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function readReview(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setMessage('');
    if (file.size > 2_000_000) { setError('Rapport trop volumineux (2 Mo maximum).'); return; }
    try {
      const data: ReviewReport = JSON.parse(await file.text());
      if (!Array.isArray(data.channels) || data.channels.length > 5000 ||
          data.channels.some(x => !x || typeof x.id !== 'string' ||
            typeof x.name !== 'string' || typeof x.categorySuggestion !== 'string' ||
            typeof x.height !== 'number')) throw new Error('Format de rapport invalide.');
      setReview(data.channels);
      setMessage(data.channels.length + ' candidates chargées localement. Aucune modification enregistrée.');
    } catch (err) { setReview([]); setError('Rapport invalide : ' + String(err)); }
  }
  function editReviewCandidate(candidate: ReviewCandidate) {
    const existing = channels.find(c => c.id === candidate.id);
    if (!existing) { setError('Chaîne introuvable dans le catalogue actuel.'); return; }
    if (existing.isActive) { setError('Cette chaîne est déjà active : vérifiez son statut avant modification.'); return; }
    setEditing(existing.id);
    setForm({ ...fromChannel(existing), category: candidate.categorySuggestion === 'Démonstration' ||
      candidate.categorySuggestion === 'Autres' ? existing.category : candidate.categorySuggestion });
    setMessage('Proposition chargée dans le formulaire. Vérifiez les droits et cliquez sur Enregistrer pour appliquer la catégorie.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function readPlaylist(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setImports([]);
    if (file.size > 2_000_000) { setError('Fichier trop volumineux (maximum 2 Mo).'); return; }
    try { setImports(parseM3u(await file.text())); }
    catch (err) { setError(String(err)); }
    e.target.value = '';
  }
  async function importSelected() {
    if (!rightsNote.trim()) { setError('Indiquez la preuve ou la provenance des droits de diffusion.'); return; }
    if (!window.confirm('Importer ' + imports.length + ' chaînes désactivées ?')) return;
    setBusy(true); setError(''); setMessage('');
    let count = 0;
    try {
      for (const c of imports) {
        await request('POST', { ...c, rightsNote });
        count++;
      }
      setMessage(count + ' chaînes importées, toutes désactivées. Vérifiez les droits avant activation.');
      setImports([]); await load();
    } catch (e) {
      setError(count + ' chaînes importées avant erreur : ' + String(e));
      await load();
    } finally { setBusy(false); }
  }
  const field = (key: keyof FormValues, label: string, required = false) => (
    <label className="flex flex-col gap-1 text-sm text-inkMuted" key={key}>
      {label}
      <input className="rounded border border-white/20 bg-black/30 px-3 py-2 text-ink"
        required={required} value={form[key]}
        onChange={e => setForm(v => ({ ...v, [key]: e.target.value }))} />
    </label>
  );
  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
      <div>
        <h1 className="text-3xl font-semibold">Chaînes TV et programmes</h1>
        <p className="mt-2 text-sm text-inkMuted">
          Les chaînes inactives ne sont jamais affichées dans Dream-Films ni dans le guide TV.
          Les flux intégrés nécessitent des droits de diffusion explicites.
        </p>
      </div>
      {error && <p role="alert" className="rounded border border-red-500 p-3 text-red-300">{error}</p>}
      {message && <p role="status" className="rounded border border-green-600 p-3 text-green-300">{message}</p>}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Chaînes ({channels.filter(c => c.isActive).length} actives / {channels.length})</h2>
        <div className="overflow-x-auto rounded border border-white/15">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-inkMuted"><tr>
              <th className="p-3">N°</th><th className="p-3">Chaîne</th>
              <th className="p-3">Catégorie</th><th className="p-3">Source</th>
              <th className="p-3">État</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>
              {channels.map(c => <tr key={c.id} className="border-t border-white/10">
                <td className="p-3">{c.number ?? '—'}</td>
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3">{c.category}</td>
                <td className="p-3">{c.sourceType}</td>
                <td className="p-3">{c.isActive ? 'Active' : 'Inactive'}</td>
                <td className="flex flex-wrap gap-2 p-3">
                  <button disabled={busy} className="text-accent underline" onClick={() => toggle(c)}>{c.isActive ? 'Désactiver' : 'Activer'}</button>
                  <button className="underline" onClick={() => { setEditing(c.id); setForm(fromChannel(c)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Modifier</button>
                  <button disabled={busy} className="text-red-300 underline" onClick={() => remove(c)}>Supprimer</button>
                </td>
              </tr>)}
              {channels.length === 0 && <tr><td colSpan={6} className="p-5 text-center text-inkMuted">Aucune chaîne enregistrée.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="space-y-4 rounded border border-white/15 p-5">
        <h2 className="text-xl font-semibold">Révision des chaînes HD candidates</h2>
        <p className="text-sm text-inkMuted">Chargez localement le rapport tv-hd-review-v4.json.
          Les propositions sont indicatives : aucune chaîne n'est activée ni modifiée lors du chargement.
          Les droits de diffusion doivent être vérifiés séparément.</p>
        <input type="file" accept=".json,application/json" onChange={readReview} />
        {review.length > 0 && <>
          <p className="text-sm">{review.length} candidates, dont {review.filter(c => c.categorySuggestion === 'Autres').length} à classer manuellement
            et {review.filter(c => c.categorySuggestion === 'Démonstration').length} démonstrations à exclure.</p>
          <label className="flex flex-col gap-1 text-sm">Afficher
            <select className="rounded border border-white/20 bg-black/30 p-2" value={reviewFilter}
              onChange={e => setReviewFilter(e.target.value)}>
              <option value="manual">À classer manuellement</option>
              <option value="all">Toutes les candidates</option>
              <option value="demo">Démonstrations</option>
            </select>
          </label>
          <div className="max-h-96 overflow-auto rounded border border-white/15">
            <table className="w-full text-left text-sm">
              <thead><tr><th className="p-2">Chaîne</th><th className="p-2">HD annoncée</th>
                <th className="p-2">Proposition</th><th className="p-2">Action</th></tr></thead>
              <tbody>{review.filter(c => reviewFilter === 'all' ||
                (reviewFilter === 'manual' ? c.categorySuggestion === 'Autres' : c.categorySuggestion === 'Démonstration'))
                .map(c => <tr key={c.id} className="border-t border-white/10">
                  <td className="p-2">{c.name}</td><td className="p-2">{c.height}p ({c.qualitySource === 'manifest' ? 'manifeste' : 'nom'})</td>
                  <td className="p-2">{c.categorySuggestion}</td>
                  <td className="p-2"><button type="button" className="text-accent underline"
                    onClick={() => editReviewCandidate(c)}>Examiner</button></td>
                </tr>)}</tbody>
            </table>
          </div>
        </>}
      </section>
      <section className="rounded border border-white/15 p-5">
        <h2 className="mb-4 text-xl font-semibold">{editing ? 'Modifier une chaîne' : 'Ajouter une chaîne'}</h2>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {field('name', 'Nom de la chaîne', true)}
            {field('number', 'Numéro (facultatif)')}
            {field('category', 'Catégorie')}
            <label className="flex flex-col gap-1 text-sm text-inkMuted">Type de source
              <select className="rounded border border-white/20 bg-black/30 px-3 py-2 text-ink"
                value={form.sourceType} onChange={e => setForm(v => ({ ...v, sourceType: e.target.value }))}>
                <option value="OFFICIAL">Service officiel externe</option>
                <option value="HLS">HLS / M3U8 autorisé</option>
                <option value="DASH">DASH / MPD autorisé</option>
              </select>
            </label>
            {field('sourceUrl', 'URL HTTPS de la chaîne', true)}
            {field('logoUrl', 'URL HTTPS du logo')}
            {field('epgId', 'Identifiant XMLTV / EPG')}
            {field('rightsNote', 'Provenance / autorisation des droits')}
          </div>
          <div className="flex gap-3">
            <button disabled={busy} className="rounded bg-blue-600 px-4 py-2 font-medium text-white">
              {editing ? 'Enregistrer' : 'Ajouter (inactive)'}
            </button>
            {editing && <button type="button" onClick={() => { setEditing(null); setForm(empty); }} className="rounded border border-white/20 px-4 py-2">Annuler</button>}
          </div>
        </form>
      </section>
      <section className="space-y-4 rounded border border-white/15 p-5">
        <h2 className="text-xl font-semibold">Importer une playlist M3U</h2>
        <p className="text-sm text-inkMuted">Import local du fichier .m3u ou .m3u8 (2 Mo maximum, 300 chaînes maximum).
          Les entrées non HTTPS sont ignorées. Aucun flux n'est testé ni activé automatiquement.</p>
        <input type="file" accept=".m3u,.m3u8,text/plain" onChange={readPlaylist} />
        {imports.length > 0 && <>
          <p>{imports.length} chaînes détectées. Exemples : {imports.slice(0, 5).map(c => c.name).join(', ')}</p>
          <label className="flex flex-col gap-1 text-sm">Provenance / autorisation des droits pour ces flux
            <textarea className="rounded border border-white/20 bg-black/30 p-3" rows={2}
              value={rightsNote} onChange={e => setRightsNote(e.target.value)} />
          </label>
          <button disabled={busy} onClick={importSelected} className="rounded bg-blue-600 px-4 py-2 text-white">
            Importer {imports.length} chaînes désactivées
          </button>
        </>}
      </section>
    </main>
  );
}
