// desktop/renderer/src/lib/libraryCache.js
//
// Ported unchanged from the old app.js's _getCachedLibrary/_setCachedLibrary/
// _invalidateLibraryCache — same key, same 5-minute TTL, same localStorage
// shape. Kept as plain functions (not a hook) since useLibrary.js is the
// only consumer and there's no reactive state here worth wrapping.

const LIBRARY_CACHE_KEY = "strip_library_cache";
const LIBRARY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in ms

export function getCachedLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > LIBRARY_CACHE_TTL) return null;
    return data;
  } catch (_) {
    return null;
  }
}

export function setCachedLibrary(data) {
  try {
    localStorage.setItem(
      LIBRARY_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch (_) {}
}

export function invalidateLibraryCache() {
  try {
    localStorage.removeItem(LIBRARY_CACHE_KEY);
  } catch (_) {}
}
