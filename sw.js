/* Dorixonachilar kassasi — service worker */
var CACHE='kassa-v1';
var SHELL=['./','./index.html','./app.js','./config.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png','./favicon-64.png'];
self.addEventListener('install',function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(SHELL);}).then(function(){return self.skipWaiting();}));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.map(function(k){return k===CACHE?null:caches.delete(k);}));
  }).then(function(){return self.clients.claim();}));
});
self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET')return;
  var url=new URL(req.url);
  if(url.origin===location.origin){
    e.respondWith(fetch(req).then(function(res){
      var copy=res.clone();caches.open(CACHE).then(function(c){c.put(req,copy);});return res;
    }).catch(function(){return caches.match(req).then(function(r){return r||caches.match('./index.html');});}));
    return;
  }
  if(url.host==='www.gstatic.com'||url.host==='fonts.googleapis.com'||url.host==='fonts.gstatic.com'){
    e.respondWith(caches.match(req).then(function(hit){
      var net=fetch(req).then(function(res){
        var copy=res.clone();caches.open(CACHE).then(function(c){c.put(req,copy);});return res;
      }).catch(function(){return hit;});
      return hit||net;
    }));
  }
});
