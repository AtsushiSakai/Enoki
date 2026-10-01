// Cache only public application assets. Never store editor text or search queries.
const VERSION = 'enoki-v3';
const PREFIX = `enoki:${new URL(self.registration.scope).pathname}:`;
const CACHE = PREFIX + VERSION;
const FILES = [
  './', 'index.html', 'styles.css?v=enoki-3', 'app.js?v=enoki-3', 'data/emoji.json?v=enoki-3',
  'license-viewer.js', 'licenses/catalog.json',
  'vendor/hechima/hechima.js', 'vendor/hechima/hechima-worker.js',
  'vendor/keymap-engine/keymap-engine.js', 'vendor/keymaps/romaji.json',
  'vendor/hechima-wasm/hechima-wasm.js', 'vendor/hechima-wasm/hechima-wasm.wasm',
  'vendor/hechima-wasm/mozc.data.gz',
];
const urls = FILES.map((path) => new URL(path, self.registration.scope).href);
self.addEventListener('install', (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(urls);
  await self.skipWaiting();
})()));
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if ((key.startsWith(PREFIX) || key.startsWith(`kotoba:${new URL(self.registration.scope).pathname}:`)) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (!urls.includes(request.url) && request.mode !== 'navigate') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try { return await fetch(request); }
    catch (error) {
      if (request.mode === 'navigate') return (await cache.match(new URL('index.html', self.registration.scope).href)) || Response.error();
      throw error;
    }
  })());
});
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'STATUS') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const matches = await Promise.all(urls.map((file) => cache.match(file)));
    event.ports[0]?.postMessage({ ready: matches.every(Boolean), version: VERSION });
  })());
});
