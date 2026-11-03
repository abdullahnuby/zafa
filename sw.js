const CACHE = "zaffa-shell-v6";
const SHELL_FILES = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/booking-rules.mjs",
  "/manifest.webmanifest",
  "/logo.svg",
  "/icon.svg"
];
const NETWORK_FIRST = new Set(SHELL_FILES);

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith("zaffa-shell-") && key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then(clients => Promise.all(
        clients.map(client => client.navigate(client.url).catch(() => null))
      ))
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache APIs: inventory, identity and payment settings must always be fresh.
  if (url.pathname.startsWith("/api/")) return;

  // Refresh the app shell from the network first so brand and UI releases reach installed PWAs.
  if (request.mode === "navigate" || NETWORK_FIRST.has(url.pathname)) {
    event.respondWith((async () => {
      try {
        const freshRequest = new Request(request, { cache: "no-store" });
        const response = await fetch(freshRequest);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(request)) || (await caches.match("/"));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return (await caches.match("/"));
    }
  })());
});
