// 앱 셸만 캐시해서 오프라인에서도 화면이 열리게 한다.
// data.json(사내 오류 로그에서 만든 데이터)과 업로드한 엑셀은 캐시하지 않는다.
const CACHE = "errmon-v1";
const SHELL = [
  "./", "./index.html", "./style.css", "./core.js", "./app.js",
  "./vendor/xlsx.full.min.js", "./manifest.webmanifest",
  "./icon.svg", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png"
];
const NO_CACHE = ["/data.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // 데이터는 항상 네트워크로만 (디스크에 남기지 않음)
  if (NO_CACHE.some(p => url.pathname.endsWith(p))) return;
  // 네트워크 우선(새 배포 즉시 반영), 오프라인이면 캐시
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
