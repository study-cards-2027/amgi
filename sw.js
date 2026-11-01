// 오프라인 지원: 앱 파일을 기기에 저장해 두고 캐시에서 연다. sw.js(CACHE)가 바뀌면 새 버전 파일을 통째로 받아 바꾼다
const CACHE = 'amgi-v8';
const FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/study.js', 'js/ui.js', 'js/media.js', 'js/kinds.js', 'js/zip.js', 'js/table.js',
  'vendor/ts-fsrs.umd.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    // v2.5: 캐시에 있으면 그대로(뒤에서 몰래 바꾸지 않음) → 한 버전의 파일끼리만 쓰여서 업데이트 중에 섞이지 않는다.
    // 새 버전은 sw.js가 바뀌면 install에서 통째로 받아 새 CACHE에 넣는다.
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
    return res || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }));
});
