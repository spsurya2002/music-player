// Service worker registration, kept out of main.jsx so the entry file stays a
// list of what the app is made of.
//
// The worker's only job is to make the app installable — Chrome won't offer
// "Install app", and won't register the share target, without one. See
// public/sw.js for why it caches nothing.

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  // Dev is served by Vite with its own module graph and no hashed filenames; a
  // worker sitting in front of that causes more confusion than the share target
  // is worth before a real build exists.
  if (import.meta.env.DEV) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // No worker means no share target. The app itself is unaffected, and
      // there is nothing useful to say to someone who didn't ask for this.
    });
  });
}
