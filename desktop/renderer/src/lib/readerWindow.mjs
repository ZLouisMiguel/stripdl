export function getVisiblePageIndex(intersectingEntries, currentIndex = 0) {
  if (!intersectingEntries.length) return currentIndex;
  const belowTop = intersectingEntries.filter((entry) => entry.top >= 0);
  const candidates = belowTop.length ? belowTop : intersectingEntries;
  return candidates.reduce((selected, entry) => {
    if (belowTop.length) return entry.top < selected.top ? entry : selected;
    return entry.top > selected.top ? entry : selected;
  }).index;
}
