/* Reelody's service worker exists for one reason: Chrome only offers
   "Install app" — and only registers a share target — for a page backed by a
   service worker with a fetch handler. Sharing a reel from Instagram depends on
   the app being installed, so this file is what makes that possible.

   It deliberately caches nothing. Every asset filename is content-hashed and
   the shell is served no-cache (see the SPA fallback in backend/main.py); a
   cache here would only find new ways to serve a stale shell that asks for
   hashes that no longer exist. The audio is range-streamed from GridFS, which
   a naive cache would break outright.

   So: take control immediately, and pass every request straight through. */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  // Clean up anything an earlier, cache-happy version of this file left behind.
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  // Navigations only. Letting the rest fall through to the network untouched
  // keeps range requests, redirects and credentials exactly as the browser
  // would have made them.
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request));
});
