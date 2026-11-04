// Guarda la app para que funcione sin internet.
// Estrategia: primero lo guardado (abre al instante, aunque la red falle) y en segundo plano
// se baja la version nueva para la proxima vez.
const CACHE='hanzi-camino-v19';
// Los clips de voz van en su propio caché, que NO se borra al cambiar de versión: su nombre cambia
// si cambia el sonido, así que nunca quedan viejos y no hay que volver a bajar ~3 MB en cada versión.
const CACHE_VOZ='hanzi-camino-voz';
const ARCHIVOS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./kai.woff2','./hanzi-writer.min.js','./trazos.json','./partes.json','./sonidos.json','./voz/indice.json'];
// Baja los clips que falten. Si alguno falla no pasa nada: se baja la próxima vez que se oiga.
const guardaVoz=()=>caches.open(CACHE).then(c=>c.match('./voz/indice.json')).then(r=>r&&r.json()).then(async idx=>{
  if(!idx) return; const v=await caches.open(CACHE_VOZ), usados=new Set(Object.values(idx).map(f=>new URL('voz/'+f,self.registration.scope).href));
  for(const r of await v.keys()) if(!usados.has(r.url)) await v.delete(r);   // clips que ya nadie usa
  const faltan=[]; for(const u of usados) if(!(await v.match(u))) faltan.push(u);
  await Promise.allSettled(faltan.map(u=>v.add(u)));
}).catch(()=>{});
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ARCHIVOS))); self.skipWaiting(); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k!==CACHE_VOZ).map(k=>caches.delete(k)))).then(guardaVoz)); self.clients.claim(); });
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  if(/\/voz\/[0-9a-f]+\.mp3$/.test(new URL(e.request.url).pathname)){   // clip: si está guardado, de ahí
    e.respondWith(caches.open(CACHE_VOZ).then(async v=>(await v.match(e.request)) ||
      fetch(e.request).then(r=>{ if(r.ok) v.put(e.request, r.clone()); return r; })));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c=>{
    const guardado = await c.match(e.request, {ignoreSearch:true});
    const deRed = fetch(e.request).then(r=>{ if(r.ok) c.put(e.request, r.clone()); return r; }).catch(()=>null);
    if(guardado){ e.waitUntil(deRed); return guardado; }
    return (await deRed) || (await c.match('./index.html')) || Response.error();
  }));
});
