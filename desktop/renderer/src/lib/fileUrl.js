// desktop/renderer/src/lib/fileUrl.js
//
// Converts a raw filesystem path (as returned by window.strip.library.scan
// / window.strip.chapter.pages) into a strip-file:// URL the renderer can
// use directly in <img src>.
//
// URL SHAPE — read this before changing it:
// A prior version built "strip-file:///" + path, mimicking file:// URLs'
// three-slash / empty-host convention. That convention is special-cased
// by Chromium ONLY for the literal "file" scheme — a custom protocol,
// even registered with standard: true, does not inherit it. The result:
// for a Windows path like "C:/Users/...", the URL parser read up through
// the first ":" as the host ("C", lowercased to "c" by normalization),
// treated the empty remainder before the next "/" as an empty port, and
// silently dropped the drive letter — producing "strip-file://c/Users/..."
// for every single path, which is exactly why every cover and every
// chapter page failed to load at once (visible in DevTools' Network/
// Console as requests to a mangled URL missing "C:").
//
// Fix: use a fixed, non-empty host ("local-file") and encode the ENTIRE
// real path (drive letter, colon, backslashes, spaces, unicode — all of
// it) as one opaque path segment via encodeURIComponent. Nothing in the
// resulting URL looks like a host, port, or path separator to the
// parser, so there's nothing left for it to misinterpret. See
// main/index.js's strip-file protocol.handle() for the matching decode.

export function toFileUrl(rawPath) {
  if (!rawPath) return null;
  return `strip-file://local-file/${encodeURIComponent(rawPath)}`;
}
