const C='zenta-v21',F=['./','index.html','manifest.json','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(F))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x))))));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;
const net=fetch(e.request).then(r=>{if(r.ok&&(e.request.url.includes('gstatic')||e.request.url.startsWith(self.location.origin))){const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));}return r;});
e.respondWith(Promise.race([net,new Promise((_,rej)=>setTimeout(rej,3000))]).catch(()=>caches.match(e.request).then(m=>m||net)));});
