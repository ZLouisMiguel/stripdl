// desktop/renderer/src/lib/fileUrl.js
//
// Converts a raw filesystem path (as returned by window.strip.library.scan
// / window.strip.chapter.pages) into a strip-file:// URL the renderer can
// use directly in <img src>. Replaces the old inline
// `file:///${path.replace(/\\/g, "/")}` construction — see main/index.js
// for why file:// itself doesn't work here.

export function toFileUrl(rawPath) {
  if (!rawPath) return null;
  const normalized = rawPath.replace(/\\/g, "/");
  // encodeURI escapes spaces/unicode while leaving "/", ":", and other
  // URL-safe characters (including things that show up in real chapter
  // titles, like apostrophes and "!") untouched — matches what a browser
  // does internally when resolving a file:// URL from a raw path.
  return "strip-file:///" + encodeURI(normalized);
}
