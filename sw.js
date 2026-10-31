// Guarda la app para que funcione sin internet.
const CACHE='hanzi-camino-v2';
const ARCHIVOS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ARCHIVOS))); self.skipWaiting(); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
// primero la red (para recibir versiones nuevas); si no hay internet, lo guardado
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(fetch(e.request).then(r=>{ const copia=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,copia)); return r; })
    .catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
});
