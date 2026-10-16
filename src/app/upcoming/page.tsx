'use client';
import { FormEvent, useEffect, useState } from 'react';

type Item = {
  id:string; type:string; title:string; subtitle?:string|null; imageUrl?:string|null; mediaPath?:string|null;
  availableAt?:string|null; publishAt?:string|null; status:string; seasonNumber?:number|null; episodeNumber?:number|null; detectedAt:string; sourceMediaItemId?:string|null; seriesMediaItemId?:string|null;
};

export default function UpcomingPage(){
  const [items,setItems]=useState<Item[]>([]);
  const [autoPublish,setAutoPublish]=useState(false);
  const load=()=>fetch('/api/admin/upcoming').then(r=>r.json()).then(d=>{setItems(d.items||[]);setAutoPublish(Boolean(d.autoPublishNewMedia));});
  useEffect(()=>{load()},[]);

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault(); const f=new FormData(e.currentTarget);
    await fetch('/api/admin/upcoming',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(f))});
    e.currentTarget.reset(); load();
  }
  async function action(id:string,action:string,availableAt?:string){
    await fetch('/api/admin/upcoming/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,availableAt})}); load();
  }
  async function actionMany(group:Item[],actionName:string,availableAt?:string){
    await Promise.all(group.map(x=>action(x.id,actionName,availableAt)));
    await load();
  }
  async function toggleAuto(v:boolean){
    setAutoPublish(v);
    await fetch('/api/admin/upcoming',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({autoPublishNewMedia:v})}); load();
  }
  const pending=items.filter(x=>x.status==='PENDING');
  const scheduled=items.filter(x=>x.status==='UPCOMING');
  const hidden=items.filter(x=>x.status==='HIDDEN');
  const pendingGroups=groupPendingEpisodes(pending);
  return <main className="mx-auto max-w-6xl px-6 py-12 text-white">
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-3xl font-semibold">À venir</h1><p className="mt-2 text-sm text-zinc-400">Les nouveaux médias détectés par le scanner arrivent ici avant publication.</p></div>
      <label className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3">
        <input type="checkbox" checked={autoPublish} onChange={e=>toggleAuto(e.target.checked)}/>
        Publication automatique des nouveaux médias
      </label>
    </div>

    <section className="mb-10">
      <h2 className="mb-4 text-2xl font-semibold">Détectés à valider <span className="text-red-500">({pending.length})</span></h2>
      {pending.length===0 && <div className="rounded-xl border border-zinc-800 p-5 text-zinc-400">Aucun nouveau média en attente.</div>}
      <div className="grid gap-4 md:grid-cols-2">{pendingGroups.map((group,idx)=>group.length>1?<PendingEpisodeGroupCard key={`g-${idx}-${group[0].id}`} items={group} actionMany={actionMany}/>:<PendingCard key={group[0].id} item={group[0]} action={action}/>)}</div>
    </section>

    <section className="mb-10">
      <h2 className="mb-4 text-2xl font-semibold">Programmés dans le slider ({scheduled.length})</h2>
      <div className="grid gap-4 md:grid-cols-2">{scheduled.map(x=><MediaCard key={x.id} item={x} action={action}/>)}</div>
    </section>

    <section className="mb-10">
      <h2 className="mb-4 text-2xl font-semibold">Masqués ({hidden.length})</h2>
      <div className="grid gap-4 md:grid-cols-2">{hidden.map(x=><MediaCard key={x.id} item={x} action={action}/>)}</div>
    </section>

    <details className="rounded-xl border border-zinc-800 p-5">
      <summary className="cursor-pointer font-semibold">Ajouter manuellement une programmation</summary>
      <form onSubmit={submit} className="mt-5 grid gap-3">
        <select name="type" className="bg-zinc-900"><option value="MOVIE">Film</option><option value="SERIES">Série</option><option value="EPISODE">Épisode</option></select>
        <input name="title" required placeholder="Titre" className="bg-zinc-900"/><input name="subtitle" placeholder="Sous-titre / S01E04" className="bg-zinc-900"/>
        <input name="imageUrl" placeholder="URL affiche ou backdrop" className="bg-zinc-900"/><input name="mediaPath" placeholder="Chemin NAS" className="bg-zinc-900"/>
        <label>Date de disponibilité <input name="availableAt" type="datetime-local" required className="bg-zinc-900"/></label>
        <label>Afficher à partir du <input name="publishAt" type="datetime-local" className="bg-zinc-900"/></label>
        <div className="grid grid-cols-2 gap-3"><input name="seasonNumber" type="number" placeholder="Saison" className="bg-zinc-900"/><input name="episodeNumber" type="number" placeholder="Épisode" className="bg-zinc-900"/></div>
        <button className="rounded bg-red-600 px-4 py-2">Programmer</button>
      </form>
    </details>
  </main>
}


function groupPendingEpisodes(items:Item[]):Item[][] {
  const grouped=new Map<string,Item[]>();
  const singles:Item[][]=[];
  for(const item of items){
    if(item.type!=='EPISODE'){ singles.push([item]); continue; }
    // V3.15.6 : une seule carte par série mère. Les saisons restent visibles
    // à l'intérieur de la carte au lieu de créer une carte par saison.
    const key=`${item.seriesMediaItemId || item.sourceMediaItemId || item.title}`;
    const g=grouped.get(key) || []; g.push(item); grouped.set(key,g);
  }
  const episodeGroups=[...grouped.values()].map(g=>g.sort((a,b)=>
    (a.seasonNumber??0)-(b.seasonNumber??0) || (a.episodeNumber??0)-(b.episodeNumber??0)
  ));
  return [...episodeGroups,...singles];
}

function PendingEpisodeGroupCard({items,actionMany}:{items:Item[];actionMany:(items:Item[],a:string,d?:string)=>Promise<void>}){
  const [date,setDate]=useState('');
  const first=items[0];
  const seasons=[...new Set(items.map(x=>x.seasonNumber).filter((x):x is number=>x!=null))].sort((a,b)=>a-b);
  return <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
    <div className="flex gap-4 p-4">{first.imageUrl?<img src={first.imageUrl} className="h-40 w-28 rounded object-cover" alt=""/>:<div className="h-40 w-28 rounded bg-zinc-800"/>}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold uppercase text-red-500">SÉRIE · NOUVEAUX ÉPISODES</div>
        <div className="truncate text-xl font-bold">{first.title}</div>
        <div className="mb-3 text-zinc-400">{items.length} nouveaux épisodes · {seasons.length} saison{seasons.length>1?'s':''}</div>
        <div className="grid gap-2">{seasons.map(season=>{const eps=items.filter(x=>x.seasonNumber===season);return <div key={season} className="rounded-lg bg-zinc-900/70 px-3 py-2"><div className="text-sm font-semibold text-zinc-200">Saison {season} · {eps.length} épisode{eps.length>1?'s':''}</div><div className="mt-1 text-xs text-zinc-500">{eps.slice(0,5).map(x=>x.subtitle || `S${String(season).padStart(2,'0')}E${String(x.episodeNumber??0).padStart(2,'0')}`).join(' · ')}{eps.length>5?` · + ${eps.length-5} autre(s)`:''}</div></div>})}</div>
      </div>
    </div>
    <div className="grid gap-2 border-t border-zinc-800 p-4"><input value={date} onChange={e=>setDate(e.target.value)} type="datetime-local" className="rounded bg-zinc-900 p-2"/><button disabled={!date} onClick={()=>actionMany(items,'schedule',date)} className="rounded bg-red-600 px-3 py-2 disabled:opacity-40">Programmer toute la série détectée</button><div className="grid grid-cols-2 gap-2"><button onClick={()=>actionMany(items,'publish-now')} className="rounded bg-emerald-700 px-3 py-2">Publier tout</button><button onClick={()=>actionMany(items,'hide')} className="rounded bg-zinc-700 px-3 py-2">Masquer tout</button></div></div>
  </div>
}
function PendingCard({item,action}:{item:Item;action:(id:string,a:string,d?:string)=>Promise<void>}){
  const [date,setDate]=useState('');
  return <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
    <div className="flex gap-4 p-4">{item.imageUrl?<img src={item.imageUrl} className="h-36 w-24 rounded object-cover" alt=""/>:<div className="h-36 w-24 rounded bg-zinc-800"/>}
      <div className="min-w-0 flex-1"><div className="text-xs font-bold uppercase text-red-500">{item.type}</div><div className="truncate text-lg font-bold">{item.title}</div>{item.subtitle&&<div className="text-zinc-400">{item.subtitle}</div>}<div className="mt-2 break-all text-xs text-zinc-500">{item.mediaPath}</div><div className="mt-2 text-xs text-zinc-500">Détecté le {new Date(item.detectedAt).toLocaleString('fr-FR')}</div></div></div>
    <div className="grid gap-2 border-t border-zinc-800 p-4"><input value={date} onChange={e=>setDate(e.target.value)} type="datetime-local" className="rounded bg-zinc-900 p-2"/><button disabled={!date} onClick={()=>action(item.id,'schedule',date)} className="rounded bg-red-600 px-3 py-2 disabled:opacity-40">Programmer cette sortie</button><div className="grid grid-cols-2 gap-2"><button onClick={()=>action(item.id,'publish-now')} className="rounded bg-emerald-700 px-3 py-2">Publier maintenant</button><button onClick={()=>action(item.id,'hide')} className="rounded bg-zinc-700 px-3 py-2">Masquer</button></div></div>
  </div>
}
function MediaCard({item,action}:{item:Item;action:(id:string,a:string,d?:string)=>Promise<void>}){
  return <div className="flex gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">{item.imageUrl?<img src={item.imageUrl} className="h-28 w-20 rounded object-cover" alt=""/>:<div className="h-28 w-20 rounded bg-zinc-800"/>}<div className="flex-1"><b>{item.title}</b>{item.subtitle&&<div className="text-sm text-zinc-400">{item.subtitle}</div>}<div className="mt-1 text-sm text-red-500">{item.availableAt?new Date(item.availableAt).toLocaleString('fr-FR'):item.status}</div><div className="mt-3 flex gap-2"><button onClick={()=>action(item.id,'publish-now')} className="rounded bg-emerald-700 px-3 py-1.5 text-sm">Publier maintenant</button><button onClick={()=>action(item.id,'hide')} className="rounded bg-zinc-700 px-3 py-1.5 text-sm">Masquer</button></div></div></div>
}
