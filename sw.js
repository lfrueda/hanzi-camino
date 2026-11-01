// Guarda la app para que funcione sin internet.
// Estrategia: primero lo guardado (abre al instante, aunque la red falle) y en segundo plano
// se baja la version nueva para la proxima vez.
const CACHE='hanzi-camino-v5';
const ARCHIVOS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./kai.woff2','./hanzi-writer.min.js','./trazos.json'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ARCHIVOS))); self.skipWaiting(); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(caches.open(CACHE).then(async c=>{
    const guardado = await c.match(e.request, {ignoreSearch:true});
    const deRed = fetch(e.request).then(r=>{ if(r.ok) c.put(e.request, r.clone()); return r; }).catch(()=>null);
    if(guardado){ e.waitUntil(deRed); return guardado; }
    return (await deRed) || (await c.match('./index.html')) || Response.error();
  }));
});
